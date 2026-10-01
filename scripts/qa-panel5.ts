import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { can, canReviewOnboardingOf, type Capability } from "../lib/permissions";
import { applyLeaveDecision } from "../lib/leave-decide";
import { isJobName, ladderRung, runDocumentPurge, runMorningDigest } from "../lib/jobs";
import { changeRoleAs, disableAccountAs, enableAccountAs } from "../lib/accounts";
import { addDays, calendarDate, daysBetween, todayInDhaka } from "../lib/dates";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";

/**
 * Panel 5 — the Super Admin.
 *
 * The gate checks from the plan: the final approval notifies the applicant AND
 * every approver at the same moment and only then moves the balance; the Super
 * Admin sees no bank details and cannot verify attendance; and the scheduled
 * jobs send one morning email per person rather than one per request.
 *
 * Everything goes through the real functions. The leave decisions call
 * `applyLeaveDecision`, which is what the three screens call.
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

const madeUsers: string[] = [];
const madeLeaveTypes: string[] = [];
const madeKeys: string[] = [];

async function person(name: string, role: Role, managerId?: string) {
  const email = `qa-${name.toLowerCase().replace(/\s+/g, "-")}@qa.fcsl.invalid`;
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
      managerId: managerId ?? null,
      joiningDate: calendarDate(2024, 1, 1),
    },
  });
  madeUsers.push(user.id);
  return { user, employee };
}

const actorFor = (p: { user: { id: string; role: Role }; employee: { id: string; fullName: string } }) => ({
  userId: p.user.id,
  role: p.user.role,
  employeeId: p.employee.id,
  name: p.employee.fullName,
});

async function main() {
  await cleanFixtures();
  const today = todayInDhaka();

  try {
    // -----------------------------------------------------------------------
    console.log("\nThe Panel 5 pages are locks, not hidden menus");
    const pages: { path: string; capability: Capability; also?: Role[] }[] = [
      { path: "/admin/approvals", capability: "leave.approveFinal" },
      { path: "/admin/accounts", capability: "accounts.manage" },
      // The Super Admin's alone since FCSL's decision of 10 September 2026.
      { path: "/admin/audit", capability: "audit.read" },
    ];
    const roles: Role[] = ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"];
    for (const page of pages) {
      const allowed = roles.filter((role) => can({ id: "x", role }, page.capability));
      const expected = ["SUPER_ADMIN", ...(page.also ?? [])].sort();
      check(
        `${page.path} — open to ${allowed.join(", ")} and nobody else`,
        JSON.stringify([...allowed].sort()) === JSON.stringify(expected),
        `expected ${expected.join(", ")}`,
      );
    }
    check(
      "the HR Head cannot reach final approval",
      !can({ id: "x", role: "HR_HEAD" }, "leave.approveFinal"),
    );
    check(
      "and cannot manage accounts",
      !can({ id: "x", role: "HR_HEAD" }, "accounts.manage"),
    );

    console.log("\nThe two rows §9 gets wrong, confirmed at this panel");
    check(
      "the Super Admin sees no bank details",
      !can({ id: "x", role: "SUPER_ADMIN" }, "bankDetails.read"),
    );
    check(
      "and has no attendance verify or publish action",
      !can({ id: "x", role: "SUPER_ADMIN" }, "attendance.verify"),
    );
    check(
      "while HR still has both",
      can({ id: "x", role: "HR_EXECUTIVE" }, "bankDetails.read") &&
        can({ id: "x", role: "HR_EXECUTIVE" }, "attendance.verify"),
    );

    // -----------------------------------------------------------------------
    console.log("\nThe one door nobody else can open");
    const superAdmin = await person("QA Admin", "SUPER_ADMIN");
    const hrHead = await person("QA Head", "HR_HEAD");
    const hrExec = await person("QA Exec", "HR_EXECUTIVE");
    const boss = await person("QA Boss", "MANAGER");
    const staff = await person("QA Worker", "EMPLOYEE", boss.employee.id);

    const asExec = { id: hrExec.user.id, role: hrExec.user.role };
    const asHead = { id: hrHead.user.id, role: hrHead.user.role };
    const asAdmin = { id: superAdmin.user.id, role: superAdmin.user.role };

    check("an HR Executive reviews an ordinary joiner", canReviewOnboardingOf(asExec, "EMPLOYEE"));
    check("and a manager's file too", canReviewOnboardingOf(asExec, "MANAGER"));
    check(
      "but NOT the HR Head's own — §7.3 sends that to the Super Admin",
      !canReviewOnboardingOf(asExec, "HR_HEAD"),
    );
    check("the HR Head cannot review their own kind either", !canReviewOnboardingOf(asHead, "HR_HEAD"));
    check("the Super Admin can", canReviewOnboardingOf(asAdmin, "HR_HEAD"));
    check(
      "a manager cannot review anybody, having no documents.approve at all",
      !canReviewOnboardingOf({ id: boss.user.id, role: "MANAGER" }, "EMPLOYEE"),
    );

    // -----------------------------------------------------------------------
    console.log("\nFinal approval is the only moment leave is granted");
    const leaveType = await prisma.leaveType.create({
      data: {
        name: "QA Panel5 leave",
        code: `QA5${Date.now() % 100000}`,
        rules: {
          create: [{ effectiveFrom: calendarDate(2020, 1, 1), daysPerYear: 10, createdByName: "qa" }],
        },
      },
    });
    madeLeaveTypes.push(leaveType.id);
    await prisma.leaveEntitlement.create({
      data: {
        employeeId: staff.employee.id,
        leaveTypeId: leaveType.id,
        fromDate: calendarDate(today.getUTCFullYear(), 1, 1),
        toDate: calendarDate(today.getUTCFullYear(), 12, 31),
        days: 10,
        source: "GRANT",
      },
    });

    // A Monday and a Tuesday, so the cost is unambiguous.
    const start = calendarDate(2026, 10, 5);
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: staff.employee.id,
        leaveTypeId: leaveType.id,
        reason: "QA reason",
        currentStep: 0,
        currentApproverRole: "MANAGER",
        days: {
          create: [
            { date: start, employeeId: staff.employee.id, leaveTypeId: leaveType.id, dayKind: "WORKING", lengthDays: 1 },
            { date: addDays(start, 1), employeeId: staff.employee.id, leaveTypeId: leaveType.id, dayKind: "WORKING", lengthDays: 1 },
          ],
        },
      },
    });

    const consumed = () =>
      prisma.leaveDayEntitlement.count({
        where: { leaveDay: { leaveRequestId: request.id } },
      });

    const step1 = await applyLeaveDecision(actorFor(boss), request.id, "GRANT", "Fine by me.");
    check("the manager's grant passes it on", "ok" in step1 && step1.outcome === "passed");
    check("and moves nothing off the balance", (await consumed()) === 0);

    const step2 = await applyLeaveDecision(actorFor(hrHead), request.id, "GRANT", "Agreed.");
    check("the HR Head's grant passes it on too", "ok" in step2 && step2.outcome === "passed");
    check("still nothing off the balance", (await consumed()) === 0);

    const outOfTurn = await applyLeaveDecision(actorFor(boss), request.id, "GRANT", "Me again.");
    check(
      "and the manager cannot approve again out of turn",
      "error" in outOfTurn,
      JSON.stringify(outOfTurn),
    );

    const before = new Date();
    const step3 = await applyLeaveDecision(
      actorFor(superAdmin),
      request.id,
      "GRANT",
      "Approved.",
      "",
      true,
    );
    check("the Super Admin's grant finishes it", "ok" in step3 && step3.outcome === "granted");
    check("NOW the days come off the balance", (await consumed()) === 2);

    const told = await prisma.notification.findMany({
      where: { createdAt: { gte: before }, title: { contains: "granted" } },
      include: { user: { select: { role: true } } },
    });
    const toldRoles = new Set(told.map((t) => t.user.role));
    check("the applicant is told", toldRoles.has("EMPLOYEE"));
    check("their manager is told", toldRoles.has("MANAGER"));
    check("the HR Head is told", toldRoles.has("HR_HEAD"));
    check("the Super Admin who approved it is told", toldRoles.has("SUPER_ADMIN"));
    check(
      "and all of them at the same moment, not in a trickle",
      new Set(told.map((t) => t.createdAt.getTime())).size === 1,
      `${new Set(told.map((t) => t.createdAt.getTime())).size} distinct instants`,
    );

    const granted = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: request.id } });
    check("the request is closed", granted.status === "GRANTED" && granted.currentApproverRole === null);

    // -----------------------------------------------------------------------
    console.log("\nA denial at the last step still tells nobody above — there is nobody above");
    const second = await prisma.leaveRequest.create({
      data: {
        employeeId: staff.employee.id,
        leaveTypeId: leaveType.id,
        reason: "QA second",
        currentStep: 2,
        currentApproverRole: "SUPER_ADMIN",
        days: {
          create: [
            {
              date: addDays(start, 14),
              employeeId: staff.employee.id,
              leaveTypeId: leaveType.id,
              dayKind: "WORKING",
              lengthDays: 1,
            },
          ],
        },
      },
    });
    const emptyReason = await applyLeaveDecision(actorFor(superAdmin), second.id, "DENY", "");
    check("an empty denial reason is refused, at this step as at every other", "error" in emptyReason);

    const denyMark = new Date();
    const denied = await applyLeaveDecision(actorFor(superAdmin), second.id, "DENY", "Too many away.");
    check("a denial with a reason is accepted", "ok" in denied && denied.outcome === "denied");
    const afterDeny = await prisma.notification.findMany({
      where: { createdAt: { gte: denyMark } },
      include: { user: { select: { role: true } } },
    });
    check(
      "only the applicant is told",
      afterDeny.length === 1 && afterDeny[0]!.user.role === "EMPLOYEE",
      afterDeny.map((n) => n.user.role).join(", "),
    );
    check(
      "and no days were taken",
      (await prisma.leaveDayEntitlement.count({ where: { leaveDay: { leaveRequestId: second.id } } })) === 0,
    );

    // -----------------------------------------------------------------------
    console.log("\nThe certificate ladder lands where §8 says");
    const expiry = calendarDate(2027, 3, 14);
    // Asked by DATE rather than by a day count. "Four months before" is 120
    // days here and 123 for a certificate expiring in July, which is exactly
    // why the code asks lib/certificate.ts instead of counting — and why a
    // test written in day offsets would be testing my arithmetic rather than
    // the rule.
    const rungOnDate = (date: Date) => ladderRung(daysBetween(date, expiry), date, expiry)?.name ?? null;

    check("five months out is silence", rungOnDate(calendarDate(2026, 10, 14)) === null);
    check(
      "four months out, on the day of the month, it speaks",
      rungOnDate(calendarDate(2026, 11, 14)) === "monthly",
    );
    check("then again a month later", rungOnDate(calendarDate(2026, 12, 14)) === "monthly");
    check("and again in January", rungOnDate(calendarDate(2027, 1, 14)) === "monthly");
    check(
      "but not on the days in between",
      rungOnDate(calendarDate(2026, 12, 15)) === null && rungOnDate(calendarDate(2027, 1, 2)) === null,
    );

    const rungOn = (isoDaysBefore: number) => {
      const day = addDays(expiry, -isoDaysBefore);
      return ladderRung(isoDaysBefore, day, expiry)?.name ?? null;
    };
    check("in the final month it is weekly", rungOn(28) === "final-month-weekly");
    check("and 27 days is not a week boundary", rungOn(27) === null);
    check("seven days out, weekly again", rungOn(7) === "final-month-weekly");
    check(
      "on the day itself it is EXPIRED, which is what §8's second row says",
      ladderRung(0, expiry, expiry)?.name === "expired-today",
    );
    check("a week after, weekly until resolved", ladderRung(-7, addDays(expiry, 7), expiry)?.name === "expired-weekly");
    check("but not on the days between", ladderRung(-3, addDays(expiry, 3), expiry) === null);

    // -----------------------------------------------------------------------
    console.log("\nThe morning digest is ONE email per person, not one per request");
    await prisma.notification.updateMany({ where: { digestedAt: null }, data: { digestedAt: new Date() } });
    await prisma.notification.createMany({
      data: [
        { userId: staff.user.id, title: "QA one" },
        { userId: staff.user.id, title: "QA two" },
        { userId: staff.user.id, title: "QA three" },
        { userId: hrHead.user.id, title: "QA four" },
      ],
    });
    const digest = await runMorningDigest();
    check("four items across two people", digest.considered === 4, `${digest.considered}`);
    check("becomes two emails", digest.acted === 2, `${digest.acted}`);
    check(
      "and everything it reported is marked digested",
      (await prisma.notification.count({ where: { digestedAt: null } })) === 0,
    );
    const again = await runMorningDigest();
    check("running it twice sends nothing the second time", again.acted === 0);

    // -----------------------------------------------------------------------
    console.log("\nThe one-year purge removes the FILES and keeps the RECORD");
    const leaver = await person("QA Leaver", "EMPLOYEE");
    await prisma.employee.update({
      where: { id: leaver.employee.id },
      data: { status: "LEFT", lastWorkingDay: addDays(today, -400) },
    });
    for (const kind of ["NID", "PHOTOGRAPH"] as const) {
      const key = `qa/${leaver.employee.id}/${kind}`;
      madeKeys.push(key);
      await prisma.employeeDocument.create({
        data: {
          employeeId: leaver.employee.id,
          kind,
          storageKey: key,
          originalName: `${kind}.pdf`,
          mimeType: "application/pdf",
          size: 10,
          status: "ACCEPTED",
        },
      });
    }
    await prisma.exit.create({
      data: {
        employeeId: leaver.employee.id,
        reason: "RESIGNATION",
        lastWorkingDay: addDays(today, -400),
        documentsPurgeAfter: addDays(today, -35),
        completedAt: new Date(),
      },
    });

    const purge = await runDocumentPurge(today);
    check("the purge finds the leaver", purge.considered >= 1);
    const docsAfter = await prisma.employeeDocument.findMany({
      where: { employeeId: leaver.employee.id },
    });
    check("the document rows are still there", docsAfter.length === 2);
    check("every one is marked purged", docsAfter.every((d) => d.purgedAt !== null));
    const recordAfter = await prisma.employee.findUnique({ where: { id: leaver.employee.id } });
    check(
      "and the employee record is untouched, so headcount stays correct",
      recordAfter !== null && recordAfter.fullName === "QA Leaver",
    );
    const purgedAgain = await runDocumentPurge(today);
    check(
      "a second run does not purge them again",
      !purgedAgain.notes.some((n) => n.includes("QA Leaver")),
    );

    // -----------------------------------------------------------------------
    console.log("\nTurning an account off");
    const admin = { userId: superAdmin.user.id, role: superAdmin.user.role, name: "QA Admin" };

    // An open session, so the revocation has something to revoke.
    const session = await prisma.session.create({
      data: {
        userId: hrExec.user.id,
        expiresAt: addDays(today, 7),
        userAgent: "qa",
        ip: "::1",
      },
    });

    check(
      "no reason, no action",
      "error" in (await disableAccountAs(admin, hrExec.user.id, "")),
    );
    check(
      "a reason under five characters is still no reason",
      "error" in (await disableAccountAs(admin, hrExec.user.id, "bad")),
    );
    check(
      "the account is untouched by a refused attempt",
      (await prisma.user.findUniqueOrThrow({ where: { id: hrExec.user.id } })).disabledAt === null,
    );

    const disabled = await disableAccountAs(admin, hrExec.user.id, "Left the company.");
    check("with a reason it goes off", "ok" in disabled);
    check(
      "their open session went with it, in the same transaction",
      (await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt !== null,
    );
    check(
      "their employee record is untouched — nothing is ever deleted",
      (await prisma.employee.count({ where: { userId: hrExec.user.id } })) === 1,
    );
    check(
      "and the permanent record says who and why",
      (await prisma.auditEvent.count({
        where: { action: "account.disabled", targetId: hrExec.user.id },
      })) === 1,
    );
    check(
      "disabling it twice is refused",
      "error" in (await disableAccountAs(admin, hrExec.user.id, "Again, why not.")),
    );

    check(
      "a Super Admin cannot disable themselves — that desk cannot be empty",
      "error" in (await disableAccountAs(admin, superAdmin.user.id, "Going on holiday.")),
    );

    // Every other Super Admin in the fixture set is this one, but the live
    // database has its own. The rule is asserted against whatever is really
    // there rather than against an assumption about the fixture.
    const activeAdmins = await prisma.user.count({
      where: { role: "SUPER_ADMIN", disabledAt: null, id: { not: superAdmin.user.id } },
    });
    if (activeAdmins === 0) {
      check(
        "the last Super Admin cannot be demoted",
        "error" in (await changeRoleAs(admin, superAdmin.user.id, "EMPLOYEE", "Stepping down.")),
      );
    } else {
      check(
        `stepping down is allowed while ${activeAdmins} other Super Admin(s) remain`,
        "ok" in (await changeRoleAs(admin, superAdmin.user.id, "HR_HEAD", "Handed over.")),
      );
      await prisma.user.update({ where: { id: superAdmin.user.id }, data: { role: "SUPER_ADMIN" } });
    }

    console.log("\nAnd back on again");
    check("re-enabling needs a reason too", "error" in (await enableAccountAs(admin, hrExec.user.id, "")));
    check("with one, it comes back", "ok" in (await enableAccountAs(admin, hrExec.user.id, "Rejoined.")));
    check(
      "the account is usable again",
      (await prisma.user.findUniqueOrThrow({ where: { id: hrExec.user.id } })).disabledAt === null,
    );

    await prisma.user.update({ where: { id: hrExec.user.id }, data: { disabledAt: new Date() } });
    await prisma.employee.update({ where: { id: hrExec.employee.id }, data: { status: "LEFT" } });
    check(
      "but somebody marked LEFT cannot be quietly let back in",
      "error" in (await enableAccountAs(admin, hrExec.user.id, "Changed my mind.")),
    );

    console.log("\nThe cron endpoint dispatches only jobs it knows");
    check("a real job name is accepted", isJobName("certificates"));
    check("a made-up one is not", !isJobName("drop-everything"));
    check("and neither is an empty string", !isJobName(""));
  } finally {
    await prisma.leaveDayEntitlement.deleteMany({
      where: { leaveDay: { leaveRequest: { employee: { userId: { in: madeUsers } } } } },
    });
    await prisma.leaveRequest.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.leaveEntitlement.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.exit.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.leaveTypeRule.deleteMany({ where: { leaveTypeId: { in: madeLeaveTypes } } });
    await prisma.leaveType.deleteMany({ where: { id: { in: madeLeaveTypes } } });
    await prisma.reminderState.deleteMany({ where: { key: { startsWith: "qa" } } });
    await prisma.employee.deleteMany({ where: { userId: { in: madeUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
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
