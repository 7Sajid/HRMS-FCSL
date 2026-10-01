import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { calendarDate } from "../lib/dates";
import { chainStart } from "../lib/approval-chain";
import { planLeaveDays } from "../lib/leave";
import { ensureEntitlements, leaveTypesFor } from "../lib/leave-service";
import { applyLeaveDecision } from "../lib/leave-decide";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";

/**
 * The leave chain (§7.1) against a real database.
 *
 * The three rules are the part of the specification most likely to cause an
 * argument later, so each is asserted by its consequence rather than by its
 * implementation: who ends up notified, and what ends up on the balance.
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

const made: string[] = [];

async function person(name: string, role: Role, managerEmployeeId?: string) {
  const email = `qa-${name.toLowerCase().replace(/\s+/g, "-")}@qa.fcsl.invalid`;
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("qa-password-not-real", 10),
      role,
      mustChangePassword: false,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      fullName: name,
      onboardingStatus: "APPROVED",
      joiningDate: calendarDate(2026, 1, 1),
      managerId: managerEmployeeId ?? null,
    },
  });
  made.push(user.id);
  return { user, employee };
}

/**
 * Exactly what the screen calls — not a re-staging of what it would produce.
 * A test that writes the outcome itself and then checks its own writing proves
 * only that the test is self-consistent.
 */
function decideAs(
  actor: { user: { id: string; role: Role }; employee: { id: string } },
  name: string,
  requestId: string,
  decision: "GRANT" | "DENY",
  reason = "",
  // The final approver must say whether it is paid (FCSL, 1 October 2026).
  // Harmless at earlier steps, which ignore it.
  paid: boolean | null = true,
) {
  return applyLeaveDecision(
    { userId: actor.user.id, role: actor.user.role, employeeId: actor.employee.id, name },
    requestId,
    decision,
    reason,
    "",
    paid,
  );
}

async function main() {
  // A previous run killed partway through (piped to `head`, say) leaves its
  // fixtures behind. Sweep before starting rather than trusting a finally.
  await cleanFixtures();

  const boss = await person("QA Boss", "MANAGER");
  const hrHead = await person("QA HR Head", "HR_HEAD");
  const superAdmin = await person("QA Super Admin", "SUPER_ADMIN");
  const staff = await person("QA Staff", "EMPLOYEE", boss.employee.id);

  try {
    await ensureEntitlements(staff.employee, calendarDate(2026, 6, 1));
    const casual = (await leaveTypesFor(staff.employee, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;

    const apply = async () => {
      const days = planLeaveDays(calendarDate(2026, 10, 5), calendarDate(2026, 10, 7), new Set());
      return prisma.leaveRequest.create({
        data: {
          employeeId: staff.employee.id,
          leaveTypeId: casual.id,
          reason: "QA",
          status: "PENDING",
          currentStep: 0,
          currentApproverRole: chainStart("EMPLOYEE").approver,
          days: {
            create: days.map((d) => ({
              employeeId: staff.employee.id,
              leaveTypeId: casual.id,
              date: d.date,
              dayKind: d.dayKind,
              lengthDays: d.lengthDays,
            })),
          },
        },
      });
    };

    console.log("\nRule 2 — a denial stops the chain dead");
    const denied = await apply();

    const empty = await decideAs(boss, "QA Boss", denied.id, "DENY", "");
    check(
      "a denial with no reason is refused",
      "error" in empty && /give a reason/.test(empty.error),
      JSON.stringify(empty),
    );

    const notTheirs = await decideAs(hrHead, "QA HR Head", denied.id, "GRANT");
    check(
      "the HR Head cannot reach past the manager",
      "error" in notTheirs && /not waiting with you/.test(notTheirs.error),
      JSON.stringify(notTheirs),
    );

    const wrongManager = await decideAs(
      { user: { id: hrHead.user.id, role: "MANAGER" as Role }, employee: hrHead.employee },
      "Not their manager",
      denied.id,
      "GRANT",
    );
    check(
      "a manager who is not THEIR manager is refused",
      "error" in wrongManager && /not waiting with you/.test(wrongManager.error),
      JSON.stringify(wrongManager),
    );

    const refusal = await decideAs(
      boss,
      "QA Boss",
      denied.id,
      "DENY",
      "The branch cannot spare you that week.",
    );
    check("the manager's denial is accepted", "ok" in refusal && refusal.outcome === "denied");

    const deniedRow = await prisma.leaveRequest.findUnique({ where: { id: denied.id } });
    check("the application is closed", deniedRow?.status === "DENIED");
    check("it is in nobody's inbox", deniedRow?.currentApproverRole === null);

    const hrHeardAboutDenial = await prisma.notification.count({
      where: { userId: hrHead.user.id, title: { contains: "casual leave" } },
    });
    const adminHeardAboutDenial = await prisma.notification.count({
      where: { userId: superAdmin.user.id, title: { contains: "casual leave" } },
    });
    // "it is not passed to the HR Head and the Super Admin never hears about it"
    check("the HR Head was never told", hrHeardAboutDenial === 0, String(hrHeardAboutDenial));
    check("the Super Admin was never told", adminHeardAboutDenial === 0, String(adminHeardAboutDenial));
    check(
      "the applicant was told, with the reason",
      (await prisma.notification.count({
        where: { userId: staff.user.id, body: { contains: "cannot spare" } },
      })) === 1,
    );

    const afterDenial = (await leaveTypesFor(staff.employee, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;
    check("nothing came off the balance", afterDenial.balance.taken === 0);
    check("and nothing stays reserved", afterDenial.balance.pending === 0);

    console.log("\nRule 1 — one step at a time, in order");
    const travelling = await apply();
    check("it starts with the manager", travelling.currentApproverRole === "MANAGER");

    const passedUp = await decideAs(boss, "QA Boss", travelling.id, "GRANT");
    check("the manager grants", "ok" in passedUp && passedUp.outcome === "passed");

    const twice = await decideAs(boss, "QA Boss", travelling.id, "GRANT");
    check(
      "the manager cannot decide it again",
      "error" in twice && /not waiting with you/.test(twice.error),
      JSON.stringify(twice),
    );

    const skipAhead = await decideAs(superAdmin, "QA Super Admin", travelling.id, "GRANT");
    check(
      "the Super Admin cannot reach past the HR Head",
      "error" in skipAhead && /not waiting with you/.test(skipAhead.error),
      JSON.stringify(skipAhead),
    );
    let row = await prisma.leaveRequest.findUnique({ where: { id: travelling.id } });
    check("granting passes it to the HR Head, it does not finish it", row?.status === "PENDING");
    check("and it now sits with the HR Head", row?.currentApproverRole === "HR_HEAD");

    const junctionMidway = await prisma.leaveDayEntitlement.count({
      where: { leaveDay: { leaveRequestId: travelling.id } },
    });
    // §7.1 rule 3 — not yet.
    check("no entitlement consumed at the halfway point", junctionMidway === 0);

    console.log("\nRule 3 — the final approval is the only moment leave is granted");
    const hrGrant = await decideAs(hrHead, "QA HR Head", travelling.id, "GRANT");
    check("the HR Head passes it to the Super Admin", "ok" in hrGrant && hrGrant.outcome === "passed");

    const final = await decideAs(superAdmin, "QA Super Admin", travelling.id, "GRANT");
    check("the Super Admin's grant is the final one", "ok" in final && final.outcome === "granted");

    // Rule 3: the applicant AND every approver, together.
    for (const [who, id] of [
      ["the applicant", staff.user.id],
      ["their manager", boss.user.id],
      ["the HR Head", hrHead.user.id],
    ] as const) {
      const told = await prisma.notification.count({
        where: { userId: id, title: { contains: "granted" } },
      });
      check(`${who} was told it was granted`, told === 1, String(told));
    }

    row = await prisma.leaveRequest.findUnique({ where: { id: travelling.id } });
    check("the application is granted", row?.status === "GRANTED");

    const finalBalance = (await leaveTypesFor(staff.employee, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;
    check("three days have come off the balance", finalBalance.balance.taken === 3, String(finalBalance.balance.taken));
    check("and nothing is left pending", finalBalance.balance.pending === 0);
    // The executive joined 1 January 2026 and is on probation: casual leave is FCSL's
    // 6-day advance, out of their first permanent year.
    check("three remain of six", finalBalance.balance.available === 3, String(finalBalance.balance.available));

    const allocations = await prisma.leaveDayEntitlement.findMany({
      where: { leaveDay: { leaveRequestId: travelling.id } },
    });
    check("one junction row per working day, none for the weekend", allocations.length === 3, String(allocations.length));

    const approvals = await prisma.leaveApproval.findMany({
      where: { leaveRequestId: travelling.id },
      orderBy: { step: "asc" },
    });
    check(
      "every step is on the record with who decided it",
      approvals.map((a) => a.approverRole).join(",") === "MANAGER,HR_HEAD,SUPER_ADMIN",
      approvals.map((a) => a.approverRole).join(","),
    );
  } finally {
    await prisma.employee.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
