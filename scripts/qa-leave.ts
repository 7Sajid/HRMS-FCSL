import bcrypt from "bcryptjs";
import { calendarDate, toISODate } from "../lib/dates";
import { chainStart } from "../lib/approval-chain";
import { ensureEntitlements, leaveTypesFor, bookedDates } from "../lib/leave-service";
import { planLeaveDays } from "../lib/leave";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";

/**
 * The leave module against a real database.
 *
 * The arithmetic is covered by lib/leave.test.ts without a database; this
 * checks the parts only a database can be wrong about — entitlement granting,
 * the day rows, and what does and does not come off a balance.
 */

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // A previous run killed partway through (piped to `head`, say) leaves its
  // fixtures behind. Sweep before starting rather than trusting a finally.
  await cleanFixtures();

  const email = "qa-leave@qa.fcsl.invalid";
  await prisma.user.deleteMany({ where: { email } });

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("qa-password-not-real", 10),
      role: "EMPLOYEE",
      mustChangePassword: false,
    },
  });
  let qaTypeId: string | null = null;
  let qaTypeCode = "";

  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      fullName: "QA Leave Applicant",
      onboardingStatus: "APPROVED",
      // Joined 1 January 2026, so on probation until 1 January 2027: casual
      // leave is the advance FCSL described — 6 days, usable now, out of the
      // first permanent year.
      joiningDate: calendarDate(2026, 1, 1),
    },
  });

  try {
    console.log("\nEntitlements are granted lazily and only once");
    await ensureEntitlements(employee, calendarDate(2026, 6, 1));
    const first = await prisma.leaveEntitlement.count({ where: { employeeId: employee.id } });
    await ensureEntitlements(employee, calendarDate(2026, 6, 1));
    const second = await prisma.leaveEntitlement.count({ where: { employeeId: employee.id } });
    check("running it twice grants nothing extra", first === second && first > 0, `${first} then ${second}`);

    const types = await leaveTypesFor(employee, calendarDate(2026, 6, 1));
    const casual = types.find((t) => t.code === "CASUAL")!;
    check("casual leave is FCSL's 6 days, available during probation", casual.balance.entitled === 6, String(casual.balance.entitled));
    check("nothing is taken yet", casual.balance.taken === 0);
    const earned = types.find((t) => t.code === "EARNED")!;
    check(
      "earned leave is closed during probation, and says the day it opens",
      earned.balance.entitled === 0 && earned.availableFrom?.getTime() === calendarDate(2027, 1, 1).getTime(),
    );
    check("all of it is applicable", casual.balance.applicable === 6);

    console.log("\nApplying materialises every calendar date");
    const days = planLeaveDays(calendarDate(2026, 9, 10), calendarDate(2026, 9, 13), new Set());
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: casual.id,
        reason: "QA",
        status: "PENDING",
        currentStep: 0,
        currentApproverRole: chainStart("EMPLOYEE").approver,
        days: {
          create: days.map((d) => ({
            employeeId: employee.id,
            leaveTypeId: casual.id,
            date: d.date,
            dayKind: d.dayKind,
            lengthDays: d.lengthDays,
          })),
        },
      },
      include: { days: true },
    });

    check("four calendar days are stored", request.days.length === 4, String(request.days.length));
    check(
      "the weekend is stored at zero length, not dropped",
      request.days.filter((d) => d.dayKind === "WEEKLY_OFF").length === 2 &&
        request.days.filter((d) => d.dayKind === "WEEKLY_OFF").every((d) => Number(d.lengthDays) === 0),
    );
    check("it starts with the manager", request.currentApproverRole === "MANAGER");

    console.log("\nWhat a pending application does and does not do");
    const afterApply = (await leaveTypesFor(employee, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;
    // §7.1 rule 3: "The days come off the balance at this moment and not
    // before" — that moment being the Super Admin's approval.
    check("nothing has come off the balance", afterApply.balance.taken === 0);
    check("but two days are reserved as pending", afterApply.balance.pending === 2, String(afterApply.balance.pending));
    check("so only four can be applied for", afterApply.balance.applicable === 4, String(afterApply.balance.applicable));

    const junction = await prisma.leaveDayEntitlement.count({
      where: { leaveDay: { employeeId: employee.id } },
    });
    check("no entitlement has been consumed yet", junction === 0, `${junction} rows`);

    console.log("\nThe same dates cannot be applied for twice");
    const booked = await bookedDates(employee.id);
    check("the working days are booked", booked.has("2026-09-10") && booked.has("2026-09-13"));
    check(
      "the weekend inside the range is not booked, because it costs nothing",
      !booked.has("2026-09-11") && !booked.has("2026-09-12"),
    );

    console.log("\nWithdrawing gives the days back");
    await prisma.leaveRequest.update({
      where: { id: request.id },
      data: { status: "WITHDRAWN", currentApproverRole: null },
    });
    const afterWithdraw = (await leaveTypesFor(employee, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;
    check("the pending days are released", afterWithdraw.balance.pending === 0);
    check("the full balance is applicable again", afterWithdraw.balance.applicable === 6);
    const stillThere = await prisma.leaveDay.count({ where: { leaveRequestId: request.id } });
    check("the record of the application is kept", stillThere === 4, `${stillThere} day rows`);

    console.log("\nLast year's leave computes on last year's rule");
    // Its own leave type, not the seeded CASUAL one. Adding a dated rule to a
    // real type and then deleting it back out by predicate would remove a rule
    // an HR Head had genuinely entered on the same date — a QA script must not
    // be able to reach real configuration.
    qaTypeCode = `QALEAVE${Date.now() % 100000}`;
    const qaType = await prisma.leaveType.create({
      data: {
        name: "QA dated leave",
        code: qaTypeCode,
        rules: {
          create: [
            { effectiveFrom: calendarDate(2020, 1, 1), daysPerYear: 10, createdByName: "qa" },
            { effectiveFrom: calendarDate(2027, 1, 1), daysPerYear: 15, createdByName: "qa" },
          ],
        },
      },
    });
    qaTypeId = qaType.id;

    await ensureEntitlements(employee, calendarDate(2026, 6, 1));
    const stillTen = (await leaveTypesFor(employee, calendarDate(2026, 6, 1))).find((t) => t.code === qaTypeCode)!;
    check("the leave year from 1 January 2026 uses the rule in force then", stillTen.balance.entitled === 10, String(stillTen.balance.entitled));
    await ensureEntitlements(employee, calendarDate(2027, 6, 1));
    const nextYear = (await leaveTypesFor(employee, calendarDate(2027, 6, 1))).find((t) => t.code === qaTypeCode)!;
    check("the next leave year uses the new one", nextYear.balance.entitled === 15, String(nextYear.balance.entitled));
  } finally {
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    if (qaTypeId) {
      await prisma.leaveTypeRule.deleteMany({ where: { leaveTypeId: qaTypeId } });
      await prisma.leaveType.deleteMany({ where: { id: qaTypeId } });
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
  void toISODate;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
