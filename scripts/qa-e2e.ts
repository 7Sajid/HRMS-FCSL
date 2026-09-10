import bcrypt from "bcryptjs";
import type { Role, StaffType } from "@prisma/client";
import { prisma, finish } from "./_cli";
import { cleanFixtures } from "./qa-clean";

import {
  can,
  canReadBankDetailsOf,
  canReadDocumentsOf,
  canReadNote,
  canReadShowCause,
  canReviewOnboardingOf,
} from "../lib/permissions";
import { allocateEmployeeId, employeeIdIsTaken, parseEmployeeId } from "../lib/employee-id";
import { requiredKinds } from "../lib/documents";
import { loadOnboardingState } from "../lib/onboarding";
import { ensureEntitlements, leaveTypesFor, bookedDates } from "../lib/leave-service";
import {
  DEFAULT_MAXIMUM_LEAVE_DAYS,
  planLeaveDays,
  preflight,
  workingDayCost,
} from "../lib/leave";
import { applyLeaveDecision } from "../lib/leave-decide";
import { chainStart, canDecideAt } from "../lib/approval-chain";
import { decideRequisition } from "../lib/requisition-decide";
import { prefillMonth, canSubmit, isLockedMark } from "../lib/attendance";
import { certificateStatus } from "../lib/certificate";
import { exitBlockers, purgeDateFor, CLEARANCE_CHECKLIST } from "../lib/exit";
import { headcount, leaveReport, terminalReport } from "../lib/reports";
import { disableAccountAs } from "../lib/accounts";
import { JOB_NAMES, runJobs } from "../lib/jobs";
import { auditWhere, readFilters } from "../lib/audit-query";
import { addDays, calendarDate, daysInMonth, todayInDhaka, toISODate } from "../lib/dates";

/**
 * END TO END — one company, one month, every module.
 *
 * The panel harnesses each prove one area in depth. This one proves the
 * JOINS between them, which is where a system of ten working parts actually
 * fails: leave that is granted but never reaches the attendance sheet, an
 * exit that completes while a terminal is still out, a certificate register
 * and a terminal register that each look right and disagree with each other.
 *
 * It walks one RM from an empty account to a completed exit, and everything
 * it touches goes through the real functions — the same ones the screens
 * call. Nothing is staged and then checked against its own staging.
 */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const madeUsers: string[] = [];
const madeBranches: string[] = [];
const madeTerminals: string[] = [];
const madeLeaveTypes: string[] = [];

async function makeAccount(
  fullName: string,
  role: Role,
  staffType: StaffType = "STAFF",
  managerId?: string,
) {
  const email = `qa-${fullName.toLowerCase().replace(/\s+/g, "-")}@qa.fcsl.invalid`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("qa-not-a-real-password", 10),
      role,
      mustChangePassword: true,
      tempPasswordExpiresAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });
  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      fullName,
      mobile: "01712345678",
      staffType,
      onboardingStatus: "DRAFT",
      managerId: managerId ?? null,
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
  const year = today.getUTCFullYear();

  try {
    // =======================================================================
    section("1 · The company exists before anybody joins it");

    const branch = await prisma.branch.create({
      data: {
        name: "QA Gulshan Branch",
        code: `QAG${Date.now() % 100000}`,
        openedOn: calendarDate(2020, 1, 1),
      },
    });
    madeBranches.push(branch.id);

    const [dept, desig, grade] = await Promise.all([
      prisma.department.findFirstOrThrow({ where: { retiredAt: null } }),
      prisma.designation.findFirstOrThrow({ where: { retiredAt: null } }),
      prisma.grade.findFirstOrThrow({ where: { retiredAt: null } }),
    ]);
    check("a branch, department, designation and grade are in place", Boolean(branch && dept && desig && grade));

    const admin = await makeAccount("E2E Admin", "SUPER_ADMIN");
    const head = await makeAccount("E2E Head", "HR_HEAD");
    const exec = await makeAccount("E2E Exec", "HR_EXECUTIVE");
    const boss = await makeAccount("E2E Boss", "MANAGER");
    for (const p of [admin, head, exec, boss]) {
      await prisma.employee.update({
        where: { id: p.employee.id },
        data: { onboardingStatus: "APPROVED", branchId: branch.id, joiningDate: calendarDate(2022, 1, 1) },
      });
    }
    await prisma.branch.update({ where: { id: branch.id }, data: { branchManagerId: boss.employee.id } });
    check("the five kinds of user exist, with a branch manager", madeUsers.length === 4);

    // =======================================================================
    section("2 · A new RM arrives at the locked door (§3, §4)");

    const rm = await makeAccount("E2E Karim", "EMPLOYEE", "RM", boss.employee.id);
    check("their account carries a temporary password that expires", rm.user.tempPasswordExpiresAt !== null);
    check("and forces a change on first use", rm.user.mustChangePassword);
    check("they have no employee ID yet", rm.employee.employeeId === null);
    check("and they are at DRAFT — the door is shut", rm.employee.onboardingStatus === "DRAFT");

    const rmRequired = requiredKinds("RM");
    const staffRequired = requiredKinds("STAFF");
    check(
      "an RM's list demands more than a plain employee's",
      rmRequired.length > staffRequired.length,
      `RM ${rmRequired.length} vs staff ${staffRequired.length}`,
    );
    check("and it includes the RM certificate", rmRequired.includes("RM_CERTIFICATE"));
    check("which a plain employee is never asked for", !staffRequired.includes("RM_CERTIFICATE"));

    const emptyState = await loadOnboardingState(rm.employee);
    check("nothing is uploaded, so nothing is complete", !emptyState.progress.complete);
    check(
      `the counter reads "${emptyState.progress.label}"`,
      /0 of \d+/.test(emptyState.progress.label),
      emptyState.progress.label,
    );

    // Upload every required document, exactly as the onboarding screen does.
    for (const kind of rmRequired) {
      if (kind === "BANK_DETAILS") continue; // a form, not a file
      await prisma.employeeDocument.create({
        data: {
          employeeId: rm.employee.id,
          kind,
          storageKey: `qa/e2e/${rm.employee.id}/${kind}`,
          originalName: `${kind}.pdf`,
          mimeType: "application/pdf",
          size: 1024,
          status: "PENDING",
          uploadedByName: "E2E Karim",
          ...(kind === "RM_CERTIFICATE"
            ? { issueDate: calendarDate(year - 1, 3, 14), expiryDate: calendarDate(year + 1, 3, 14) }
            : {}),
        },
      });
    }
    await prisma.employeeBankDetail.create({
      data: {
        employeeId: rm.employee.id,
        bankName: "Dutch-Bangla Bank",
        branchName: "Gulshan",
        accountName: "Karim Hossain",
        accountNumber: "1011234567890",
      },
    });
    await prisma.emergencyContact.create({
      data: {
        employeeId: rm.employee.id,
        slot: 1,
        name: "Abdul Karim",
        relationship: "Father",
        mobile: "01812345678",
        status: "CURRENT",
      },
    });

    const filled = await loadOnboardingState(
      await prisma.employee.findUniqueOrThrow({ where: { id: rm.employee.id } }),
    );
    check("with everything uploaded, the file is complete", filled.progress.complete, filled.missing.join(", "));

    await prisma.employee.update({
      where: { id: rm.employee.id },
      data: { onboardingStatus: "SUBMITTED", submittedAt: new Date() },
    });

    // =======================================================================
    section("3 · HR reviews, sends back, and finally opens the door (§4)");

    check(
      "the HR Executive may review an ordinary joiner",
      canReviewOnboardingOf({ id: exec.user.id, role: "HR_EXECUTIVE" }, "EMPLOYEE"),
    );
    check(
      "but not the HR Head's own file",
      !canReviewOnboardingOf({ id: exec.user.id, role: "HR_EXECUTIVE" }, "HR_HEAD"),
    );

    // Reject one document, which is what "send back" reopens.
    const nid = await prisma.employeeDocument.findFirstOrThrow({
      where: { employeeId: rm.employee.id, kind: "NID" },
    });
    await prisma.employeeDocument.update({
      where: { id: nid.id },
      data: { status: "REJECTED", rejectionReason: "The back side is blurred.", reviewedByName: "E2E Exec" },
    });
    await prisma.employee.update({
      where: { id: rm.employee.id },
      data: { onboardingStatus: "SENT_BACK", sendBackReason: "One document to redo." },
    });

    const sentBack = await prisma.employeeDocument.findMany({ where: { employeeId: rm.employee.id } });
    check(
      "only the named document is reopened",
      sentBack.filter((d) => d.status === "REJECTED").length === 1,
    );
    check(
      "everything already accepted stays accepted, so nothing is uploaded twice",
      sentBack.filter((d) => d.status === "PENDING").length === sentBack.length - 1,
    );

    // They re-upload; the old one is superseded, never deleted.
    const replacement = await prisma.employeeDocument.create({
      data: {
        employeeId: rm.employee.id,
        kind: "NID",
        storageKey: `qa/e2e/${rm.employee.id}/NID-v2`,
        originalName: "NID-v2.pdf",
        mimeType: "application/pdf",
        size: 2048,
        status: "PENDING",
        supersedesId: nid.id,
        uploadedByName: "E2E Karim",
      },
    });
    await prisma.employeeDocument.update({
      where: { id: nid.id },
      data: { supersededAt: new Date(), supersedeReason: "Re-scanned" },
    });
    check("the replacement points at what it replaced", replacement.supersedesId === nid.id);
    check(
      "and the original is still on file — nothing is ever deleted",
      (await prisma.employeeDocument.findUnique({ where: { id: nid.id } })) !== null,
    );

    await prisma.employeeDocument.updateMany({
      where: { employeeId: rm.employee.id, supersededAt: null },
      data: { status: "ACCEPTED", reviewedByName: "E2E Exec", reviewedAt: new Date() },
    });

    // Approve: allocate the ID through the real allocator.
    const before = await prisma.employeeIdSequence.findUnique({ where: { id: 1 } });
    const allocated = await prisma.$transaction((tx) => allocateEmployeeId(tx, year));
    await prisma.employee.update({
      where: { id: rm.employee.id },
      data: {
        employeeId: allocated.employeeId,
        idLetter: allocated.parts.letter,
        idNumber: allocated.parts.number,
        idYear: allocated.parts.year,
        onboardingStatus: "APPROVED",
        status: "ACTIVE",
        branchId: branch.id,
        departmentId: dept.id,
        designationId: desig.id,
        gradeId: grade.id,
        joiningDate: calendarDate(year, 9, 1),
      },
    });
    await prisma.employeeAssignment.create({
      data: {
        employeeId: rm.employee.id,
        effectiveFrom: calendarDate(year, 9, 1),
        branchId: branch.id,
        departmentId: dept.id,
        designationId: desig.id,
        gradeId: grade.id,
        managerId: boss.employee.id,
        reason: "JOINING",
      },
    });

    const parts = parseEmployeeId(allocated.employeeId);
    check(`the ID is the right shape — ${allocated.employeeId}`, parts !== null);
    check("its suffix is always 70", allocated.employeeId.endsWith("- 70"));
    // parseEmployeeId expands the two digits back to a full year — "26 is 2026,
    // not 1926" — so the round trip is against the joining year itself.
    check("its year is the joining year", parts?.year === year, String(parts?.year));
    check("and the printed form carries only the two digits", allocated.employeeId.includes(`- ${year % 100} -`));
    check(
      "and the counter moved forward by exactly one",
      (await prisma.employeeIdSequence.findUniqueOrThrow({ where: { id: 1 } })).nextNumber ===
        (before?.nextNumber ?? 0) + 1,
    );

    const opened = await prisma.employee.findUniqueOrThrow({ where: { id: rm.employee.id } });
    check("the door is open", opened.onboardingStatus === "APPROVED");

    // =======================================================================
    section("4 · The RM certificate register (§6.8)");

    const certDoc = await prisma.employeeDocument.findFirstOrThrow({
      where: { employeeId: rm.employee.id, kind: "RM_CERTIFICATE", supersededAt: null },
    });
    const certificate = await prisma.rmCertificate.create({
      data: {
        employeeId: rm.employee.id,
        certificateNumber: "BSEC-RM-E2E-001",
        issueDate: calendarDate(year - 1, 3, 14),
        expiryDate: calendarDate(year + 1, 3, 14),
        documentId: certDoc.id,
        status: "ACTIVE",
        recordedByName: "E2E Exec",
      },
    });

    const live = certificateStatus(certificate, today);
    check(`today it reads "${live.label}"`, live.state === "VALID" || live.state === "RENEWAL_DUE");
    const nearly = certificateStatus(certificate, addDays(certificate.expiryDate, -100));
    check("a hundred days out it is amber", nearly.state === "RENEWAL_DUE");
    const lapsed = certificateStatus(certificate, addDays(certificate.expiryDate, 1));
    check("the day after expiry it is red", lapsed.state === "EXPIRED");
    check("and it never blocks — the account is untouched by any of that", opened.status === "ACTIVE");

    // =======================================================================
    section("5 · A trading terminal, and the question only the two registers together can answer (§6.9)");

    const terminal = await prisma.tradingTerminal.create({
      data: {
        terminalId: `QA-TWS-${Date.now() % 100000}`,
        exchange: "DSE",
        branchId: branch.id,
        status: "ACTIVE",
      },
    });
    madeTerminals.push(terminal.id);
    await prisma.terminalAssignment.create({
      data: {
        terminalId: terminal.id,
        employeeId: rm.employee.id,
        assignedOn: calendarDate(year, 9, 1),
        assignedByName: "E2E Head",
      },
    });

    const held = await prisma.terminalAssignment.findFirst({
      where: { terminalId: terminal.id, releasedOn: null },
    });
    check("the terminal has a current holder", held !== null);

    // =======================================================================
    section("6 · Leave, all the way up the chain (§7.1)");

    const leaveType = await prisma.leaveType.create({
      data: {
        name: "E2E leave",
        code: `E2E${Date.now() % 100000}`,
        rules: {
          create: [
            {
              effectiveFrom: calendarDate(2020, 1, 1),
              daysPerYear: 12,
              createdByName: "e2e",
              overBalance: "REFUSE",
            },
          ],
        },
      },
    });
    madeLeaveTypes.push(leaveType.id);

    const withEmployee = await prisma.employee.findUniqueOrThrow({ where: { id: rm.employee.id } });
    await ensureEntitlements(withEmployee, today);
    const types = await leaveTypesFor(withEmployee, today);
    const mine = types.find((t) => t.code === leaveType.code)!;
    // Leave years run from the joining date (FCSL, 10 September 2026), so a
    // September joiner's first year starts in September with the whole year's
    // days — there is no January left to pro-rate from.
    check(
      `a September joiner's leave year starts on their joining date — ${mine.balance.entitled} of 12`,
      mine.balance.entitled === 12 && mine.period.from.getTime() === calendarDate(year, 9, 1).getTime(),
      `${mine.balance.entitled} from ${toISODate(mine.period.from)}`,
    );

    // Four calendar days spanning a Friday and Saturday.
    const thursday = calendarDate(year, 10, 8);
    const holidays = new Set<string>();
    const planned = planLeaveDays(thursday, addDays(thursday, 3), holidays, new Set(), [5, 6]);
    const cost = workingDayCost(planned);
    check(
      "four calendar days across a weekend cost two working days",
      cost === 2,
      `${cost} — ${planned.map((d) => `${toISODate(d.date)}:${d.dayKind}`).join(" ")}`,
    );
    check(
      "the Friday and Saturday are kept on the application at zero length",
      planned.filter((d) => d.dayKind === "WEEKLY_OFF").length === 2,
    );

    const flight = preflight({
      from: thursday,
      to: addDays(thursday, 3),
      today,
      days: planned,
      balances: [{ period: mine.period, balance: mine.balance }],
      overBalance: "REFUSE",
      lateReason: "",
      overlappingDates: await bookedDates(rm.employee.id),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 1,
    });
    check("the pre-flight checks pass", flight.ok, flight.errors.join(" | "));

    const tooMany = preflight({
      from: thursday,
      to: addDays(thursday, 60),
      today,
      days: planLeaveDays(thursday, addDays(thursday, 60), holidays, new Set(), [5, 6]),
      balances: [{ period: mine.period, balance: mine.balance }],
      overBalance: "REFUSE",
      lateReason: "",
      overlappingDates: new Set(),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 1,
    });
    check("asking for more than the balance is refused", !tooMany.ok);

    const backdated = preflight({
      from: addDays(today, -5),
      to: addDays(today, -4),
      today,
      days: planLeaveDays(addDays(today, -5), addDays(today, -4), holidays, new Set(), [5, 6]),
      balances: [{ period: mine.period, balance: mine.balance }],
      overBalance: "REFUSE",
      lateReason: "",
      overlappingDates: new Set(),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 1,
    });
    check("a backdated application without a reason is refused", !backdated.ok);

    const start = chainStart("EMPLOYEE");
    check("an employee's application starts with their manager", start.approver === "MANAGER");

    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: rm.employee.id,
        leaveTypeId: leaveType.id,
        reason: "Family wedding in Sylhet.",
        currentStep: start.step,
        currentApproverRole: start.approver,
        days: {
          create: planned.map((d) => ({
            date: d.date,
            employeeId: rm.employee.id,
            leaveTypeId: leaveType.id,
            dayKind: d.dayKind,
            lengthDays: d.lengthDays,
          })),
        },
      },
    });

    const consumed = () =>
      prisma.leaveDayEntitlement.count({ where: { leaveDay: { leaveRequestId: request.id } } });

    check(
      "the HR Head cannot decide it while it sits with the manager",
      !canDecideAt("EMPLOYEE", 0, "HR_HEAD"),
    );
    const skipped = await applyLeaveDecision(actorFor(head), request.id, "GRANT", "Fine.");
    check("and the real path refuses them", "error" in skipped);

    const notMyTeam = await makeAccount("E2E Other Boss", "MANAGER");
    await prisma.employee.update({
      where: { id: notMyTeam.employee.id },
      data: { onboardingStatus: "APPROVED" },
    });
    const wrongManager = await applyLeaveDecision(actorFor(notMyTeam), request.id, "GRANT", "Sure.");
    check("another manager entirely is refused too", "error" in wrongManager);

    const s1 = await applyLeaveDecision(actorFor(boss), request.id, "GRANT", "Approved.");
    check("their own manager may grant it", "ok" in s1 && s1.outcome === "passed");
    check("nothing has left the balance", (await consumed()) === 0);

    const s2 = await applyLeaveDecision(actorFor(head), request.id, "GRANT", "Agreed.");
    check("the HR Head passes it on", "ok" in s2 && s2.outcome === "passed");
    check("still nothing off the balance", (await consumed()) === 0);

    const mark = new Date();
    const s3 = await applyLeaveDecision(actorFor(admin), request.id, "GRANT", "Approved.");
    check("the Super Admin's grant is the one that counts", "ok" in s3 && s3.outcome === "granted");
    check("NOW two days leave the balance", (await consumed()) === 2);

    const told = await prisma.notification.findMany({
      where: { createdAt: { gte: mark }, title: { contains: "granted" } },
      include: { user: { select: { role: true } } },
    });
    check(
      "the applicant and all three approvers are told",
      new Set(told.map((t) => t.user.role)).size === 4,
      [...new Set(told.map((t) => t.user.role))].join(", "),
    );
    check(
      "at one and the same instant",
      new Set(told.map((t) => t.createdAt.getTime())).size === 1,
    );

    section("6b · And a denial, which stops dead");
    const second = await prisma.leaveRequest.create({
      data: {
        employeeId: rm.employee.id,
        leaveTypeId: leaveType.id,
        reason: "Second try.",
        currentStep: 0,
        currentApproverRole: "MANAGER",
        days: {
          create: [
            {
              date: calendarDate(year, 11, 5),
              employeeId: rm.employee.id,
              leaveTypeId: leaveType.id,
              dayKind: "WORKING",
              lengthDays: 1,
            },
          ],
        },
      },
    });
    const denyMark = new Date();
    check(
      "an empty denial reason is refused",
      "error" in (await applyLeaveDecision(actorFor(boss), second.id, "DENY", "")),
    );
    const denied = await applyLeaveDecision(actorFor(boss), second.id, "DENY", "Too many away that week.");
    check("with a reason it is denied", "ok" in denied && denied.outcome === "denied");

    const afterDeny = await prisma.notification.findMany({
      where: { createdAt: { gte: denyMark } },
      include: { user: { select: { role: true } } },
    });
    check(
      "only the applicant is told — nobody above hears of it",
      afterDeny.length === 1 && afterDeny[0]!.user.role === "EMPLOYEE",
      afterDeny.map((n) => n.user.role).join(", "),
    );
    check(
      "the HR Head has no record of it at all",
      (await prisma.leaveApproval.count({ where: { leaveRequestId: second.id, approverRole: "HR_HEAD" } })) === 0,
    );

    // =======================================================================
    section("7 · The attendance sheet knows about the leave (§6.3)");

    const month = 10;
    const sheet = await prisma.attendanceSheet.create({
      data: { branchId: branch.id, year, month, status: "OPEN" },
    });

    const grantedDates = await prisma.leaveDay.findMany({
      where: { leaveRequestId: request.id, lengthDays: { gt: 0 } },
      select: { date: true },
    });
    const onLeave = new Set(grantedDates.map((d) => toISODate(d.date)));

    const cells = prefillMonth(year, month, {
      holidays: new Set<string>(),
      weeklyOffDays: [5, 6],
      onLeave,
      from: calendarDate(year, 9, 1),
      to: null,
    });
    check(
      `the grid spans the whole month — ${cells.length} days`,
      cells.length === daysInMonth(year, month),
    );
    const leaveCells = cells.filter((c) => c.mark === "ON_LEAVE");
    check("the granted leave is pre-filled onto the sheet", leaveCells.length === 2);
    check("and those cells cannot be contradicted", leaveCells.every((c) => isLockedMark(c.mark!)));
    check(
      "Fridays and Saturdays are locked too",
      cells.filter((c) => c.mark === "WEEKLY_OFF").every((c) => isLockedMark(c.mark!)),
    );

    const entered = new Map<string, "PRESENT">();
    for (const cell of cells) if (!cell.mark && cell.employed) entered.set(toISODate(cell.date), "PRESENT");
    check("with every open day filled, the sheet may be submitted", canSubmit(cells, entered));

    const halfDone = new Map(entered);
    halfDone.delete([...halfDone.keys()][0]!);
    check("with one day missing it may not", !canSubmit(cells, halfDone));

    await prisma.attendanceSheet.update({
      where: { id: sheet.id },
      data: { status: "SUBMITTED", submittedAt: new Date(), submittedByName: "E2E Boss" },
    });
    check(
      "submitting locks it",
      (await prisma.attendanceSheet.findUniqueOrThrow({ where: { id: sheet.id } })).status === "SUBMITTED",
    );
    check(
      "the Super Admin cannot publish it — that is HR's job (§9)",
      !can({ id: admin.user.id, role: "SUPER_ADMIN" }, "attendance.verify"),
    );
    await prisma.attendanceSheet.update({
      where: { id: sheet.id },
      data: { status: "PUBLISHED", publishedAt: new Date(), publishedByName: "E2E Exec" },
    });
    check("HR publishes it", true);

    // =======================================================================
    section("8 · A requisition, escalated on value (§6.4)");

    const thresholdSetting = await prisma.setting.findUnique({
      where: { key: "requisition.escalationThreshold" },
    });
    const threshold = Number(thresholdSetting?.value ?? 50000);

    check(
      "an employee cannot raise one — they ask their manager",
      !can({ id: rm.user.id, role: "EMPLOYEE" }, "requisitions.raise"),
    );
    check("their manager can", can({ id: boss.user.id, role: "MANAGER" }, "requisitions.raise"));

    const small = await prisma.requisition.create({
      data: {
        raisedById: boss.employee.id,
        raisedByName: "E2E Boss",
        type: "OFFICE_SUPPLIES",
        details: { item: "Printer paper", quantity: "20 reams" },
        amount: threshold - 1000,
        currentStep: 0,
        currentApproverRole: "HR_HEAD",
      },
    });
    const smallDecided = await decideRequisition(actorFor(head), small.id, "APPROVE", "Fine.");
    check(
      "below the threshold the HR Head's approval is final",
      "ok" in smallDecided,
      JSON.stringify(smallDecided),
    );
    check(
      "and it is finished",
      (await prisma.requisition.findUniqueOrThrow({ where: { id: small.id } })).status === "APPROVED",
    );

    const big = await prisma.requisition.create({
      data: {
        raisedById: boss.employee.id,
        raisedByName: "E2E Boss",
        type: "IT_EQUIPMENT",
        details: { item: "Six trading workstations" },
        amount: threshold + 100000,
        currentStep: 0,
        currentApproverRole: "HR_HEAD",
      },
    });
    await decideRequisition(actorFor(head), big.id, "APPROVE", "Needed.");
    const escalated = await prisma.requisition.findUniqueOrThrow({ where: { id: big.id } });
    check(
      "above it, the HR Head's approval passes it to the Super Admin",
      escalated.status === "PENDING" && escalated.currentApproverRole === "SUPER_ADMIN",
      `${escalated.status} / ${escalated.currentApproverRole}`,
    );
    await decideRequisition(actorFor(admin), big.id, "APPROVE", "Approved.");
    check(
      "who finishes it",
      (await prisma.requisition.findUniqueOrThrow({ where: { id: big.id } })).status === "APPROVED",
    );

    // =======================================================================
    section("9 · A show-cause letter, and who may read it (§6.5)");

    const showCause = await prisma.showCause.create({
      data: {
        employeeId: rm.employee.id,
        subject: "Late arrival",
        body: "You were recorded as late on six occasions.",
        issuedById: head.user.id,
        issuedByName: "E2E Head",
        visibleToManager: false,
      },
    });
    check(
      "the employee it is about may read it",
      canReadShowCause({ id: rm.user.id, role: "EMPLOYEE" }, showCause, rm.employee.id, false),
    );
    check(
      "their manager may NOT — refused by default, §6.5",
      !canReadShowCause({ id: boss.user.id, role: "MANAGER" }, showCause, boss.employee.id, true),
    );
    check(
      "the HR Head may",
      canReadShowCause({ id: head.user.id, role: "HR_HEAD" }, showCause, head.employee.id, false),
    );
    check(
      "the HR Executive has no show-cause capability at all",
      !can({ id: exec.user.id, role: "HR_EXECUTIVE" }, "showcause.readAny"),
    );
    await prisma.showCause.update({
      where: { id: showCause.id },
      data: {
        replyBody: "There was severe traffic on the Gulshan link road.",
        repliedAt: new Date(),
        outcome: "WARNING",
        closedAt: new Date(),
        closedByName: "E2E Head",
      },
    });
    const closed = await prisma.showCause.findUniqueOrThrow({ where: { id: showCause.id } });
    check("the letter, the reply and the outcome stay together",
      closed.replyBody !== "" && closed.outcome === "WARNING" && closed.closedAt !== null);

    // =======================================================================
    section("10 · Privacy, asked of lib/permissions.ts (§9)");

    const viewerBoss = { id: boss.user.id, role: "MANAGER" as Role };
    const viewerExec = { id: exec.user.id, role: "HR_EXECUTIVE" as Role };
    const viewerAdmin = { id: admin.user.id, role: "SUPER_ADMIN" as Role };

    check(
      "a manager may not read anybody's documents",
      !canReadDocumentsOf(viewerBoss, rm.employee.id, boss.employee.id, "NID"),
    );
    check(
      "but may read their own",
      canReadDocumentsOf(viewerBoss, boss.employee.id, boss.employee.id, "NID"),
    );
    check("a manager may not read bank details", !canReadBankDetailsOf(viewerBoss, rm.employee.id, boss.employee.id));
    check("HR may", canReadBankDetailsOf(viewerExec, rm.employee.id, exec.employee.id));
    check(
      "the SUPER ADMIN may NOT — the row people try to fix",
      !canReadBankDetailsOf(viewerAdmin, rm.employee.id, admin.employee.id),
    );
    check(
      "and the employee may read their own",
      canReadBankDetailsOf({ id: rm.user.id, role: "EMPLOYEE" }, rm.employee.id, rm.employee.id),
    );

    const note = await prisma.note.create({ data: { userId: rm.user.id, body: "A private note.", date: today } });
    check("the owner may read their own note", canReadNote(note, rm.user.id));
    check("the Super Admin may not — nobody may, at any level", !canReadNote(note, admin.user.id));
    check("nor the HR Head", !canReadNote(note, head.user.id));

    // =======================================================================
    section("11 · Reports agree with what actually happened (§6.10)");

    const counts = await headcount();
    check(
      `the headcount counts everybody approved — ${counts.active} active, ${counts.left} left`,
      counts.active >= 5,
      JSON.stringify({ active: counts.active, left: counts.left }),
    );
    check(
      "and breaks down by branch",
      counts.byBranch.some((b) => b.name === branch.name),
      counts.byBranch.map((b) => b.name).join(", "),
    );

    const leaveRows = await leaveReport(year);
    const mineInReport = leaveRows.byType.find((t) => t.name === "E2E leave");
    check(
      "the leave report counts the two days that were actually granted",
      mineInReport !== undefined && mineInReport.daysTaken === 2,
      JSON.stringify(mineInReport),
    );
    check(
      "and the RM is no longer in the took-none list",
      !leaveRows.tookNone.some((p) => p.id === rm.employee.id),
    );

    const terminals = await terminalReport();
    check("the terminal register sees the assigned terminal", terminals.assigned >= 1);

    // =======================================================================
    section("12 · The exit, and the safeguard that matters most (§6.6)");

    const lastDay = addDays(today, 30);
    const blockedByTerminal = exitBlockers({
      openTerminals: 1,
      unclearedItems: CLEARANCE_CHECKLIST.length,
    });
    check("an exit is refused while a terminal is still assigned", blockedByTerminal.length > 0);
    check(
      "and the refusal says so in words rather than just failing",
      blockedByTerminal.some((r) => /terminal/i.test(r)),
      blockedByTerminal.join(" | "),
    );

    const exit = await prisma.exit.create({
      data: {
        employeeId: rm.employee.id,
        reason: "RESIGNATION",
        lastWorkingDay: lastDay,
        documentsPurgeAfter: purgeDateFor(lastDay),
        recordedByName: "E2E Exec",
        clearanceItems: {
          create: CLEARANCE_CHECKLIST.map((c) => ({ area: c.area, label: c.label })),
        },
      },
    });
    check(
      "the purge date is one year after the last working day",
      purgeDateFor(lastDay).getUTCFullYear() === lastDay.getUTCFullYear() + 1,
    );

    await prisma.terminalAssignment.updateMany({
      where: { terminalId: terminal.id, releasedOn: null },
      data: { releasedOn: lastDay, note: "Released at exit" },
    });
    await prisma.rmCertificate.update({
      where: { id: certificate.id },
      data: { status: "SURRENDERED", surrenderedOn: lastDay },
    });
    await prisma.clearanceItem.updateMany({
      where: { exitId: exit.id },
      data: { clearedAt: new Date(), clearedByName: "E2E Exec" },
    });

    const clear = exitBlockers({ openTerminals: 0, unclearedItems: 0 });
    check("with the terminal released and clearance done, the exit may complete", clear.length === 0);

    await prisma.exit.update({
      where: { id: exit.id },
      data: { completedAt: new Date(), completedByName: "E2E Exec" },
    });
    await prisma.employee.update({
      where: { id: rm.employee.id },
      data: { status: "LEFT", lastWorkingDay: lastDay },
    });

    const gone = await prisma.employee.findUniqueOrThrow({ where: { id: rm.employee.id } });
    check("they are marked LEFT on a date", gone.status === "LEFT" && gone.lastWorkingDay !== null);
    check("their employee ID is still theirs, never reused", gone.employeeId === allocated.employeeId);
    check(
      "and their whole file survives",
      (await prisma.employeeDocument.count({ where: { employeeId: rm.employee.id } })) > 0,
    );

    const afterExit = await headcount();
    check(
      "the headcount moves them from active to left, so the total is unchanged",
      afterExit.left === counts.left + 1 && afterExit.active === counts.active - 1,
      JSON.stringify({ before: counts.active, after: afterExit.active }),
    );
    check(
      "an ID that has ever been held is refused to anybody else",
      await employeeIdIsTaken(allocated.employeeId),
    );

    // =======================================================================
    section("13 · The scheduled jobs run over all of it (§8)");

    const results = await runJobs("all", today);
    check("every job ran", results.length === JOB_NAMES.length, results.map((r) => r.job).join(", "));
    check("none of them threw", !results.some((r) => r.notes.some((n) => n.startsWith("Failed:"))));

    const digest = results.find((r) => r.job === "digest")!;
    check(
      `the digest turned ${digest.considered} notifications into ${digest.acted} emails`,
      digest.acted < digest.considered || digest.considered === 0,
      JSON.stringify(digest),
    );

    const secondRun = await runJobs("all", today);
    check(
      "running them twice in a day sends nothing the second time",
      secondRun.every((r) => r.acted === 0),
      secondRun.map((r) => `${r.job}:${r.acted}`).join(" "),
    );

    // =======================================================================
    section("14 · The permanent record has all of it, and cannot be edited (§6)");

    const line = await prisma.auditEvent.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    let updateRefused = false;
    try {
      await prisma.auditEvent.update({ where: { id: line.id }, data: { action: "auth.signed_in" } });
    } catch {
      updateRefused = true;
    }
    check("Postgres refuses an UPDATE on the log", updateRefused);

    let deleteRefused = false;
    try {
      await prisma.auditEvent.delete({ where: { id: line.id } });
    } catch {
      deleteRefused = true;
    }
    check("and a DELETE", deleteRefused);

    for (const action of ["employee.id_issued", "leave.granted", "leave.denied", "requisition.approved"]) {
      const found = await prisma.auditEvent.count({
        where: auditWhere(readFilters({ action })),
      });
      check(`the log holds "${action}"`, found > 0);
    }

    // =======================================================================
    section("15 · Turning the account off at the end");

    const disabled = await disableAccountAs(
      { userId: admin.user.id, role: "SUPER_ADMIN", name: "E2E Admin" },
      rm.user.id,
      "Left the company on their last working day.",
    );
    check("the account goes off", "ok" in disabled);
    check(
      "and the employee record stays whole — a brokerage must produce a leaver's file",
      (await prisma.employee.findUnique({ where: { id: rm.employee.id } })) !== null,
    );
  } finally {
    await prisma.leaveDayEntitlement.deleteMany({
      where: { leaveDay: { leaveRequest: { employee: { userId: { in: madeUsers } } } } },
    });
    await prisma.clearanceItem.deleteMany({ where: { exit: { employee: { userId: { in: madeUsers } } } } });
    await prisma.exit.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.terminalAssignment.deleteMany({ where: { terminalId: { in: madeTerminals } } });
    await prisma.tradingTerminal.deleteMany({ where: { id: { in: madeTerminals } } });
    await prisma.rmCertificate.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.showCause.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.requisition.deleteMany({ where: { raisedBy: { userId: { in: madeUsers } } } });
    await prisma.attendanceSheet.deleteMany({ where: { branchId: { in: madeBranches } } });
    await prisma.leaveRequest.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.leaveEntitlement.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.leaveTypeRule.deleteMany({ where: { leaveTypeId: { in: madeLeaveTypes } } });
    await prisma.leaveType.deleteMany({ where: { id: { in: madeLeaveTypes } } });
    await prisma.employeeAssignment.deleteMany({ where: { employee: { userId: { in: madeUsers } } } });
    await prisma.reminderState.deleteMany({ where: { key: { contains: "e2e" } } });
    await prisma.branch.updateMany({ where: { id: { in: madeBranches } }, data: { branchManagerId: null } });
    await prisma.employee.deleteMany({ where: { userId: { in: madeUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
    await prisma.branch.deleteMany({ where: { id: { in: madeBranches } } });
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailed:");
    for (const f of failures) console.log(`  · ${f}`);
  }
  console.log("");
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
