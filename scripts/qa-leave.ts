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
  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      fullName: "QA Leave Applicant",
      onboardingStatus: "APPROVED",
      // Joined at the start of the year, so entitlement is not pro-rated and
      // the numbers below are the full Labour Act figures.
      joiningDate: calendarDate(2026, 1, 1),
    },
  });

  try {
    console.log("\nEntitlements are granted lazily and only once");
    await ensureEntitlements(employee, 2026);
    const first = await prisma.leaveEntitlement.count({ where: { employeeId: employee.id } });
    await ensureEntitlements(employee, 2026);
    const second = await prisma.leaveEntitlement.count({ where: { employeeId: employee.id } });
    check("running it twice grants nothing extra", first === second && first > 0, `${first} then ${second}`);

    const types = await leaveTypesFor(employee, 2026);
    const casual = types.find((t) => t.code === "CASUAL")!;
    check("a full-year joiner gets the Labour Act figure", casual.balance.entitled === 10, String(casual.balance.entitled));
    check("nothing is taken yet", casual.balance.taken === 0);
    check("all of it is applicable", casual.balance.applicable === 10);

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
    const afterApply = (await leaveTypesFor(employee, 2026)).find((t) => t.code === "CASUAL")!;
    // §7.1 rule 3: "The days come off the balance at this moment and not
    // before" — that moment being the Super Admin's approval.
    check("nothing has come off the balance", afterApply.balance.taken === 0);
    check("but two days are reserved as pending", afterApply.balance.pending === 2, String(afterApply.balance.pending));
    check("so only eight can be applied for", afterApply.balance.applicable === 8, String(afterApply.balance.applicable));

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
    const afterWithdraw = (await leaveTypesFor(employee, 2026)).find((t) => t.code === "CASUAL")!;
    check("the pending days are released", afterWithdraw.balance.pending === 0);
    check("the full balance is applicable again", afterWithdraw.balance.applicable === 10);
    const stillThere = await prisma.leaveDay.count({ where: { leaveRequestId: request.id } });
    check("the record of the application is kept", stillThere === 4, `${stillThere} day rows`);

    console.log("\nLast year's leave computes on last year's rule");
    const casualType = await prisma.leaveType.findUnique({ where: { code: "CASUAL" } });
    await prisma.leaveTypeRule.create({
      data: {
        leaveTypeId: casualType!.id,
        effectiveFrom: calendarDate(2027, 1, 1),
        daysPerYear: 15,
        createdByName: "qa",
      },
    });
    const stillTen = (await leaveTypesFor(employee, 2026)).find((t) => t.code === "CASUAL")!;
    check("2026 still uses the 2026 rule", stillTen.balance.entitled === 10, String(stillTen.balance.entitled));
    await ensureEntitlements(employee, 2027);
    const nextYear = (await leaveTypesFor(employee, 2027)).find((t) => t.code === "CASUAL")!;
    check("2027 uses the new one", nextYear.balance.entitled === 15, String(nextYear.balance.entitled));
    await prisma.leaveTypeRule.deleteMany({
      where: { leaveTypeId: casualType!.id, effectiveFrom: calendarDate(2027, 1, 1) },
    });
  } finally {
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
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
