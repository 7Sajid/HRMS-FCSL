import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { addDays, calendarDate, todayInDhaka, toISODate } from "../lib/dates";
import { runAccessClosure, runNoteReminders } from "../lib/jobs";
import { ACTION_GROUPS, ACTION_LABELS, actionLabel } from "../lib/audit";
import { employeeRecordScope } from "../lib/permissions";
import { showCauseReplyPdf } from "../lib/pdf";
import { headcount, documentReport, leaveReport, monthlySummary } from "../lib/reports";
import { leaveTypesFor, leaveTypesForMany } from "../lib/leave-service";
import {
  audienceIncludes,
  DEFAULT_MAXIMUM_LEAVE_DAYS,
  carriedForwardDays,
  isUncounted,
  planLeaveDays,
  preflight,
  workingDayCost,
  leaveYearsSpanned,
  yearsSpanned,
} from "../lib/leave";
import { decideRequisition, fulfilRequisition } from "../lib/requisition-decide";
import { applyLeaveDecision } from "../lib/leave-decide";
import { enableAccountAs } from "../lib/accounts";
import { calendarForRange, ensureEntitlements } from "../lib/leave-service";
import { maximumLeaveDays } from "../lib/leave";
import { releaseLetterTemplate } from "../lib/exit";
import { releaseLetterPdf } from "../lib/pdf";
import { compressUpload, MAX_EDGE, PORTRAIT_EDGE, savingLine } from "../lib/images";
import sharp from "sharp";
import { documentKey, getObject, putObject } from "../lib/storage";
import { commitImport, unmatchedReferences } from "../lib/import-commit";
import { BURST, SIGN_IN, isRateLimited, recordAttempt } from "../lib/rate-limit";
import { consumeEntitlement } from "../lib/leave-service";
import type { CheckedRow } from "../lib/import";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";
// The library's own client, which is what lib/ and app/ actually run their
// queries through — `_cli` opens a separate one for fixtures. Counting on the
// wrong client counts nothing, quietly.
import { prisma as appPrisma } from "../lib/db";

/**
 * The four defects found in the A-to-Z audit, each with the check that would
 * have caught it.
 *
 * Two of them are provable end to end here, because the code that was wrong
 * lives in `lib/` and a script can call exactly what the screen calls. Two of
 * them are guards inside `"use server"` actions, which cannot be called
 * outside a request — `scripts/qa-exit.ts` imports `completeExit` and pointedly
 * does not call it for the same reason. For those two the check reads the
 * source, and each pattern below has been run against the pre-fix file to
 * confirm it fails there. A source check is weaker than a behavioural one and
 * is labelled as such in the output; it is not nothing, because what it pins
 * down is precisely the line whose absence was the bug.
 */

const ROOT = join(__dirname, "..");

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

/** Cleared in the `finally`, by exact id, and only after the fixture accounts
 *  are gone: `LeaveRequest.leaveType` is onDelete: Restrict on purpose, so a
 *  leave type cannot be removed while any leave still points at it. */
let regressionLeaveTypeId: string | null = null;
/** Section 17's department, cleared in the `finally` by exact id. */
const QA_DEPARTMENT = "QA Regression Department";
/** Section 35's division, cleared in its own finally. */
const QA_DIVISION = "QA Regression Division";
let requisitionDepartmentId: string | null = null;
/** The carry-forward check's own leave type, cleared the same way. */
let carryLeaveTypeId: string | null = null;

/**
 * Count the queries a piece of work runs, when PRISMA_LOG_QUERIES=1 is set.
 * Null when it is not, so the harness still runs without it and says so.
 */
const countQueries: ((work: () => Promise<unknown>) => Promise<number>) | null =
  process.env.PRISMA_LOG_QUERIES === "1"
    ? async (work) => {
        let n = 0;
        const listening = appPrisma as unknown as { $on: (e: "query", f: () => void) => void };
        listening.$on("query", () => {
          n += 1;
        });
        await work();
        // Prisma has no $off, so the count is read immediately and the
        // listener simply stops mattering once this returns.
        return n;
      }
    : null;

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/**
 * Source checks that assert something is ABSENT have to read the code and not
 * the prose about the code. This file explains at length why it does not log
 * request headers, and a plain search would find that sentence and call it the
 * thing it forbids.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

async function main() {
  await cleanFixtures();
  // A run that died before its `finally` leaves this behind, and the code is
  // unique. Cleared by that exact code, never by a predicate that could match
  // a leave type the HR Head entered.
  await prisma.leaveType.deleteMany({ where: { code: { in: ["QA_REG", "QA_REG_CARRY"] } } });
  // Same again for section 17's department, whose name is unique: a leftover
  // would fail the create rather than being quietly reused.
  await prisma.department.deleteMany({ where: { name: QA_DEPARTMENT } });
  // Section 35's, whose name is unique too. Its branches go first: a division
  // with a branch still in it cannot be removed.
  await prisma.branch.deleteMany({ where: { code: { in: ["QAMON", "QAQUI"] } } });
  await prisma.division.deleteMany({ where: { name: QA_DIVISION } });

  // ---------------------------------------------------------------------
  console.log("\n1 · A person who has left cannot sign in (§6.6)");
  // ---------------------------------------------------------------------
  const today = todayInDhaka();

  const leaver = await fixture("qa-reg-gone@qa.fcsl.invalid", "QA Already Gone", {
    status: "LEFT",
    lastWorkingDay: addDays(today, -1),
  });
  const servingNotice = await fixture("qa-reg-notice@qa.fcsl.invalid", "QA Serving Notice", {
    status: "LEFT",
    lastWorkingDay: addDays(today, 14),
  });

  const result = await runAccessClosure(today);

  const gone = await prisma.user.findUnique({
    where: { id: leaver.userId },
    include: { sessions: true },
  });
  check("the account of somebody whose last day has passed is closed", gone!.disabledAt !== null);
  check(
    "and their open session is revoked in the same breath",
    gone!.sessions.every((s) => s.revokedAt !== null),
  );

  const still = await prisma.user.findUnique({
    where: { id: servingNotice.userId },
    include: { sessions: true },
  });
  // The case that makes the whole rule non-trivial. The exit is finished and
  // the record already says LEFT, but the person is at their desk for another
  // fortnight and needs the system to do their handover.
  check("somebody serving out notice is left alone", still!.disabledAt === null);
  check(
    "and their session still works",
    still!.sessions.every((s) => s.revokedAt === null),
  );

  const line = await prisma.auditEvent.findFirst({
    where: { action: "account.disabled", targetId: leaver.userId },
    orderBy: { createdAt: "desc" },
  });
  check("the closure is written into the permanent record", Boolean(line));
  check(
    "and it says why, in a sentence somebody reading it in a year can use",
    /last working day/i.test(String((line?.detail as { reason?: string } | null)?.reason ?? "")),
  );

  check("the job reports what it did", result.job === "access" && result.acted >= 1);

  // Running it twice must not disable anybody a second time or write a second
  // line — every job in §8 is idempotent within a day.
  const again = await runAccessClosure(today);
  check("running it again finds nothing left to do", again.acted === 0);

  // ---------------------------------------------------------------------
  console.log("\n2 · The 412-employee import finishes inside a request (§12.1)");
  // ---------------------------------------------------------------------
  // The sequence is put back exactly as found. Fixture IDs would otherwise
  // move the real counter forward permanently, and it only ever moves forward.
  const sequenceBefore = await prisma.employeeIdSequence.findUnique({ where: { id: 1 } });

  const outsideManager = await fixture("qa-reg-boss@qa.fcsl.invalid", "QA Outside Manager", {
    employeeId: "A 899 - 99 - 70",
    idLetter: "A",
    idNumber: 899,
    idYear: 2099,
  });

  const ROWS = 412;
  const rows: CheckedRow[] = Array.from({ length: ROWS }, (_, i) => ({
    row: i + 2,
    employeeId: `A ${String(100 + (i % 700)).padStart(3, "0")} - 9${i % 10} - 70`,
    fullName: `QA Imported ${i}`,
    email: `qa-reg-import-${i}@qa.fcsl.invalid`,
    mobile: "01700000000",
    joiningDate: calendarDate(2020, 1, 1),
    confirmationDate: null,
    role: i === 0 ? "MANAGER" : "EMPLOYEE",
    staffType: i % 5 === 0 ? "RM" : "STAFF",
    branch: "",
    department: "",
    designation: "",
    grade: "",
    // Row 0 manages the odd ones; the pre-existing fixture manages the evens.
    // Both paths matter: a manager inside the file, and one imported earlier.
    manager: i === 0 ? "" : i % 2 === 1 ? "A 100 - 90 - 70" : "A 899 - 99 - 70",
    certificateNumber: i % 5 === 0 ? `QA-REG-CERT-${i}` : "",
    certificateIssue: i % 5 === 0 ? calendarDate(2024, 1, 1) : null,
    certificateExpiry: i % 5 === 0 ? calendarDate(2027, 1, 1) : null,
  }));
  // Employee IDs have to be unique, and the generated pattern repeats.
  const seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    row.employeeId = `A ${String(100 + Math.floor(i / 10)).padStart(3, "0")} - 9${i % 10} - 70`;
    if (seen.has(row.employeeId)) throw new Error(`duplicate fixture id ${row.employeeId}`);
    seen.add(row.employeeId);
  }
  rows[0]!.employeeId = "A 100 - 90 - 70";
  for (let i = 1; i < rows.length; i += 1) if (i % 2 === 1) rows[i]!.manager = "A 100 - 90 - 70";

  const started = Date.now();
  await commitImport(
    { userId: outsideManager.userId, role: "HR_HEAD", name: "QA Importer" },
    rows,
    { fileName: "qa-regressions.csv", skipped: 0 },
  );
  const took = Date.now() - started;

  const written = await prisma.employee.count({
    where: { user: { email: { startsWith: "qa-reg-import-" } } },
  });
  check(`all ${ROWS} rows are written`, written === ROWS, `${written}`);

  const sample = await prisma.employee.findUnique({
    where: { employeeId: "A 100 - 91 - 70" },
    include: { assignments: true, manager: true, user: true },
  });
  check("each one gets its dated assignment", sample?.assignments.length === 1);
  check(
    "with the manager already on it, not patched in afterwards",
    sample?.assignments[0]?.managerId === sample?.managerId && sample?.managerId !== null,
  );
  check("a manager inside the same file is linked", sample?.manager?.employeeId === "A 100 - 90 - 70");

  const evenRow = await prisma.employee.findUnique({
    where: { employeeId: "A 100 - 92 - 70" },
    include: { manager: true },
  });
  check(
    "a manager imported in an earlier run is linked too",
    evenRow?.manager?.employeeId === "A 899 - 99 - 70",
  );

  const certificates = await prisma.rmCertificate.count({
    where: { certificateNumber: { startsWith: "QA-REG-CERT-" } },
  });
  check("every Associate keeps their certificate", certificates === Math.ceil(ROWS / 5), `${certificates}`);

  check(
    "nobody arrives behind the locked door — imported employees are already employed",
    (await prisma.employee.count({
      where: {
        user: { email: { startsWith: "qa-reg-import-" } },
        onboardingStatus: { not: "APPROVED" },
      },
    })) === 0,
  );

  // The point of the whole rewrite. Vercel allows 60s; the old row-at-a-time
  // version spent 28s on password hashing alone before touching the database.
  const seconds = (took / 1000).toFixed(1);
  check(
    `${ROWS} rows go in with room to spare — ${seconds}s against a 60s request budget`,
    took < 25_000,
    `${seconds}s`,
  );

  // ---------------------------------------------------------------------
  console.log("\n3 · A Super Admin's leave comes off their own balance (§7.1)");
  // ---------------------------------------------------------------------
  const leave = source("app/actions/leave.ts");
  const directGrant = leave.slice(
    leave.indexOf("if (!position.approver) {"),
    leave.indexOf("await record({", leave.indexOf("if (!position.approver) {")),
  );
  check(
    "[source] the no-chain branch consumes entitlement, not only sets the status",
    /consumeEntitlement\(tx, created\.id\)/.test(directGrant),
  );
  check(
    "[source] and writes the leave.granted line, so the register is not missing it",
    /action: "leave\.granted"/.test(leave),
  );

  // And the behaviour that source check is standing in for. `applyForLeave`
  // consumes the entitlement in the SAME transaction that has just written the
  // day rows — a different order from the chained path, where the days were
  // written days or weeks earlier. Worth proving rather than assuming: if the
  // read did not see its own transaction's writes, the fix would be a no-op
  // and the balance would still never move.
  const boss = await fixture("qa-reg-super@qa.fcsl.invalid", "QA Super Admin", {});
  const type = await prisma.leaveType.create({
    data: { name: "QA Regression Leave", code: "QA_REG", sortOrder: 900 },
  });
  regressionLeaveTypeId = type.id;
  await prisma.leaveEntitlement.create({
    data: {
      employeeId: boss.employeeId,
      leaveTypeId: type.id,
      fromDate: calendarDate(2026, 1, 1),
      toDate: calendarDate(2026, 12, 31),
      days: 10,
      source: "GRANT",
      createdByName: "qa",
    },
  });

  const taken = await prisma.$transaction(async (tx) => {
    const request = await tx.leaveRequest.create({
      data: {
        employeeId: boss.employeeId,
        leaveTypeId: type.id,
        reason: "qa regression",
        status: "GRANTED",
        currentStep: 0,
        decidedAt: new Date(),
      },
    });
    await tx.leaveDay.createMany({
      data: [calendarDate(2026, 3, 2), calendarDate(2026, 3, 3)].map((date) => ({
        leaveRequestId: request.id,
        employeeId: boss.employeeId,
        leaveTypeId: type.id,
        date,
        dayKind: "WORKING" as const,
        lengthDays: 1,
      })),
    });
    return consumeEntitlement(tx, request.id);
  });

  const drawn = await prisma.leaveDayEntitlement.aggregate({
    where: { leaveDay: { employeeId: boss.employeeId } },
    _sum: { lengthDays: true },
  });
  check(
    "two days of a Super Admin's own leave actually leave the balance",
    Number(drawn._sum.lengthDays ?? 0) === 2,
    String(drawn._sum.lengthDays ?? 0),
  );
  check("with nothing unfunded — the bucket had the days", taken.shortfall === 0);

  // ---------------------------------------------------------------------
  console.log("\n4 · Attendance can only be written for this branch's people (§6.3)");
  // ---------------------------------------------------------------------
  const attendance = source("app/actions/attendance.ts");
  check(
    "[source] the employee is looked up scoped to the branch, in the query",
    /findFirst\(\{\s*where: \{\s*id: employeeId,\s*branchId,/.test(attendance),
  );
  check(
    "[source] and the date has to belong to the month the sheet is for",
    /date\.getUTCFullYear\(\) !== year \|\| date\.getUTCMonth\(\) \+ 1 !== month/.test(attendance),
  );

  // ---------------------------------------------------------------------
  console.log("\n5 · Changing your own password signs out every other device");
  // ---------------------------------------------------------------------
  const authSource = source("app/actions/auth.ts");
  const setPassword = authSource.slice(authSource.indexOf("export async function setPassword"));
  check(
    "[source] the change revokes every open session for that account",
    /session\.updateMany\(\{[\s\S]{0,160}revokedAt: null[\s\S]{0,120}revokedAt: new Date\(\)/.test(
      setPassword,
    ),
  );
  check(
    "[source] and a fresh session is issued, so this browser is not signed out too",
    /await createSession\(context\.user\.id\)/.test(setPassword),
  );

  // ---------------------------------------------------------------------
  console.log("\n6 · Withdrawing a requisition leaves a trace");
  // ---------------------------------------------------------------------
  // An action name that exists in the union but nowhere else renders as a raw
  // key in the viewer and can never be filtered to. All three or none.
  check(
    "the action has a label a person can read",
    ACTION_LABELS["requisition.withdrawn"] === "Requisition withdrawn" &&
      actionLabel("requisition.withdrawn") === "Requisition withdrawn",
  );
  check(
    "and it sits in a filter group, so it can be found",
    ACTION_GROUPS.some((g) => g.actions.includes("requisition.withdrawn")),
  );
  check(
    "[source] the withdrawal and its audit row are one transaction",
    /\$transaction\([\s\S]{0,400}action: "requisition\.withdrawn"/.test(
      source("app/actions/requisitions.ts"),
    ),
  );

  // ---------------------------------------------------------------------
  console.log("\n7 · A former manager loses everything after the transfer (§5.2)");
  // ---------------------------------------------------------------------
  const oldBoss = await fixture("qa-reg-oldboss@qa.fcsl.invalid", "QA Old Boss", {});
  const dhaka = await prisma.branch.create({
    data: { name: "QA Dhaka Regression", code: "QAD", openedOn: calendarDate(2020, 1, 1) },
  });
  const chittagong = await prisma.branch.create({
    data: { name: "QA Chittagong Regression", code: "QAC", openedOn: calendarDate(2020, 1, 1) },
  });
  const moved = await fixture("qa-reg-moved@qa.fcsl.invalid", "QA Transferred Person", {
    branchId: chittagong.id,
  });
  await prisma.employeeAssignment.create({
    data: {
      employeeId: moved.employeeId,
      effectiveFrom: calendarDate(2024, 1, 1),
      effectiveTo: calendarDate(2026, 3, 12),
      branchId: dhaka.id,
      managerId: oldBoss.employeeId,
      reason: "JOINING",
      recordedByName: "qa",
    },
  });

  // Exactly the query the roster pages run.
  const asThePageSeesIt = await prisma.employee.findFirst({
    where: { id: moved.employeeId },
    include: {
      branch: true,
      assignments: {
        where: { managerId: oldBoss.employeeId },
        orderBy: { effectiveFrom: "desc" },
        include: { branch: true },
      },
    },
  });
  const scope = employeeRecordScope(
    { id: "u", role: "MANAGER" },
    oldBoss.employeeId,
    asThePageSeesIt!,
    asThePageSeesIt!.assignments,
  );
  check("the old manager's view is limited, not open", scope?.limited === true);
  check(
    "and it stops on the transfer date",
    scope?.limited === true && toISODate(scope.until) === "2026-03-12",
    scope?.limited === true ? toISODate(scope.until) : String(scope),
  );
  // The leak made visible: the two branches differ, so a page rendering the
  // current row instead of the period row is telling the old manager where
  // this person works now.
  check(
    "the period row and the current row genuinely disagree",
    asThePageSeesIt!.branch?.name === "QA Chittagong Regression" &&
      asThePageSeesIt!.assignments[0]?.branch?.name === "QA Dhaka Regression",
  );
  const rosterSource = source("app/team/roster/[id]/page.tsx");
  check(
    "[source] the detail page renders the period row when the scope is limited",
    /const shown = period \?\? member/.test(rosterSource) &&
      /scope\.limited\s*\?\s*member\.assignments\.find/.test(rosterSource),
  );
  check(
    "[source] and does not compute current leave balances for a former report",
    // Pinned on the guard rather than on one way of writing it: the balances
    // must only ever be fetched when the scope is NOT limited.
    /if \(!scope\.limited\) \{[\s\S]{0,400}await leaveTypesFor/.test(rosterSource) &&
      !/^\s*(const balances|balances\.push).*await leaveTypesFor/m.test(
        rosterSource.replace(/if \(!scope\.limited\) \{[\s\S]*?\n  \}/, ""),
      ),
  );

  // ---------------------------------------------------------------------
  console.log("\n8 · A leave application can only cite your own file (§6.2)");
  // ---------------------------------------------------------------------
  const mine = await prisma.employeeDocument.create({
    data: {
      employeeId: moved.employeeId,
      kind: "OTHER",
      storageKey: "qa/regression/mine.pdf",
      originalName: "mine.pdf",
      mimeType: "application/pdf",
      size: 1,
      status: "ACCEPTED",
    },
  });
  const theirs = await prisma.employeeDocument.create({
    data: {
      employeeId: oldBoss.employeeId,
      kind: "OTHER",
      storageKey: "qa/regression/theirs.pdf",
      originalName: "theirs.pdf",
      mimeType: "application/pdf",
      size: 1,
      status: "ACCEPTED",
    },
  });
  // The exact ownership question the action asks.
  const owns = (documentId: string, employeeId: string) =>
    prisma.employeeDocument.findFirst({
      where: { id: documentId, employeeId, purgedAt: null },
      select: { id: true },
    });
  check("your own document matches", (await owns(mine.id, moved.employeeId)) !== null);
  check("somebody else's does not", (await owns(theirs.id, moved.employeeId)) === null);
  check(
    "[source] the action asks it before saving the application",
    /employeeDocument\.findFirst\(\{\s*where: \{ id: attachmentId, employeeId: employee\.id/.test(
      source("app/actions/leave.ts"),
    ),
  );
  check(
    "[source] and the form offers a list, so the check guards a field that can be filled",
    /name="attachmentId"/.test(source("components/leave/ApplyForLeave.tsx")),
  );

  // ---------------------------------------------------------------------
  console.log("\n9 · The show-cause reply becomes a PDF (§6.5)");
  // ---------------------------------------------------------------------
  const pdfBytes = await showCauseReplyPdf({
    employeeName: "QA Transferred Person",
    employeeCode: "A 118 - 24 - 70",
    subject: "QA regression subject",
    letterBody: "The letter this reply answers, so the file reads on its own.",
    issuedByName: "QA HR Head",
    issuedOn: "5 Sep 2026",
    replyBody: "My account of what happened. ".repeat(40),
    repliedOn: "8 Sep 2026",
  });
  check("it is a PDF", Buffer.from(pdfBytes.slice(0, 5)).toString() === "%PDF-");

  // Through the real storage driver and back, because a PDF that is generated
  // and then cannot be stored or read is not a document.
  const pdfKey = documentKey(moved.employeeId, "SHOWCAUSE_REPLY", "reply.pdf");
  await putObject(pdfKey, pdfBytes, "application/pdf");
  const readBack = await getObject(pdfKey);
  check("it survives a round trip through storage", readBack?.length === pdfBytes.length);

  // Scoped to replyToShowCause: issueShowCause opens a transaction earlier in
  // the file, and comparing positions across the whole file compared the wrong
  // two things.
  const complianceFile = source("app/actions/compliance.ts");
  const complianceSource = complianceFile.slice(
    complianceFile.indexOf("export async function replyToShowCause"),
    complianceFile.indexOf("export async function closeShowCause"),
  );
  check(
    "[source] the file is written before the rows that point at it",
    complianceSource.indexOf("await putObject(key, bytes") <
      complianceSource.indexOf("await prisma.$transaction") &&
      complianceSource.includes("await putObject(key, bytes"),
  );
  check(
    "[source] the reply is still saved when the PDF cannot be made",
    /catch \(error\) \{[\s\S]{0,400}pdfFailed/.test(complianceSource),
  );
  check(
    "[source] and replyDocumentId is actually set on the show-cause",
    /replyDocumentId,\s*\n\s*repliedAt: new Date\(\)/.test(complianceSource),
  );

  await prisma.employeeDocument.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
  await prisma.branch.deleteMany({ where: { id: { in: [dhaka.id, chittagong.id] } } });

  // ---------------------------------------------------------------------
  console.log("\n10 · Reports count in the database, and agree with counting by hand");
  // ---------------------------------------------------------------------
  const people = await headcount();
  // Counted independently, the slow obvious way, and compared. A rewrite from
  // "load every row and filter in JavaScript" to "ask the database" is only
  // worth having if it gives the same answers.
  const everyone = await prisma.employee.findMany({
    where: { onboardingStatus: "APPROVED" },
    include: { user: { select: { role: true } } },
  });
  const byHand = {
    active: everyone.filter((e) => e.status === "ACTIVE").length,
    left: everyone.filter((e) => e.status === "LEFT").length,
    managers: everyone.filter((e) => e.status === "ACTIVE" && e.user.role === "MANAGER").length,
    rms: everyone.filter(
      (e) => e.status === "ACTIVE" && e.staffType === "RM" && e.user.role !== "MANAGER",
    ).length,
    employees: everyone.filter(
      (e) => e.status === "ACTIVE" && e.staffType === "STAFF" && e.user.role !== "MANAGER",
    ).length,
  };
  check(`active: ${people.active} counted, ${byHand.active} by hand`, people.active === byHand.active);
  check(`left: ${people.left} counted, ${byHand.left} by hand`, people.left === byHand.left);
  check("managers agree", people.managers === byHand.managers, `${people.managers} vs ${byHand.managers}`);
  check("Associates agree", people.rms === byHand.rms, `${people.rms} vs ${byHand.rms}`);
  check("plain employees agree", people.employees === byHand.employees, `${people.employees} vs ${byHand.employees}`);
  check(
    "the three add up to the active headcount",
    people.managers + people.rms + people.employees === people.active,
  );
  check(
    "every branch, department and grade is still listed",
    people.byBranch.length === (await prisma.branch.count()) &&
      people.byDepartment.length === (await prisma.department.count()) &&
      people.byGrade.length === (await prisma.grade.count()),
  );

  const docs = await documentReport();
  check(
    "the incomplete-files list is capped but its count is the true one",
    docs.incomplete.length <= docs.incompleteTotal,
    `${docs.incomplete.length} shown of ${docs.incompleteTotal}`,
  );
  const leaveFigures = await leaveReport(todayInDhaka().getUTCFullYear());
  check(
    "the took-no-leave list is capped but its count is the true one",
    leaveFigures.tookNone.length <= leaveFigures.tookNoneTotal,
    `${leaveFigures.tookNone.length} shown of ${leaveFigures.tookNoneTotal}`,
  );
  check(
    "and that count agrees with counting by hand",
    leaveFigures.tookNoneTotal ===
      (await prisma.employee.count({
        where: {
          status: "ACTIVE",
          onboardingStatus: "APPROVED",
          leaveDays: {
            none: { lengthDays: { gt: 0 }, leaveRequest: { status: "GRANTED" } },
          },
        },
      })),
  );

  // ---------------------------------------------------------------------
  console.log("\n11 · One screen asks one set of questions, not one per row");
  // ---------------------------------------------------------------------
  const roster = await prisma.employee.findMany({
    where: { onboardingStatus: "APPROVED" },
    take: 20,
  });
  if (roster.length >= 2 && countQueries) {
    const batched = await countQueries(() => leaveTypesForMany(roster, calendarDate(2026, 6, 1)));
    const oneByOne = await countQueries(async () => {
      for (const person of roster) await leaveTypesFor(person, calendarDate(2026, 6, 1));
    });
    check(
      `balances for ${roster.length} people: ${batched} queries batched, ${oneByOne} one at a time`,
      batched <= 6 && batched < oneByOne,
      `${batched} vs ${oneByOne}`,
    );
    check(
      "and the batched answer is the same answer",
      JSON.stringify((await leaveTypesForMany(roster, calendarDate(2026, 6, 1))).get(roster[0]!.id)) ===
        JSON.stringify(await leaveTypesFor(roster[0]!, calendarDate(2026, 6, 1))),
    );
  } else {
    console.log("  · query counting needs PRISMA_LOG_QUERIES=1 — skipped");
  }
  check(
    "[source] the certificate job fetches the HR list once, not once per certificate",
    /const \[beforeExpiry, afterExpiry, managers\] = await Promise\.all/.test(source("lib/jobs.ts")) &&
      !/for \(const u of await usersWithRole/.test(source("lib/jobs.ts")),
  );
  check(
    "[source] the joiners queue asks for progress once for the whole list",
    /await progressLabels\(notStarted\)/.test(source("app/hr/joiners/page.tsx")),
  );

  // ---------------------------------------------------------------------
  console.log("\n12 · Leave without pay has no balance to be short of");
  // ---------------------------------------------------------------------
  const anyone = roster[0];
  if (anyone) {
    const theirTypes = await leaveTypesFor(anyone, todayInDhaka());
    const unpaid = theirTypes.find((t) => t.code === "UNPAID");
    check("the seeded unpaid type is recognised as uncounted", unpaid?.uncounted === true);
    check("and every other type is not", theirTypes.filter((t) => t.uncounted).length === 1);
  }
  check("the rule is read from the rule, not from the code", isUncounted(0, "WARN") === true);
  {
    const from = calendarDate(2026, 10, 19);
    const result = preflight({
      from,
      to: from,
      today: todayInDhaka(),
      days: planLeaveDays(from, from, new Set()),
      balances: [{ period: { from: calendarDate(2026, 1, 1), to: calendarDate(2026, 12, 31) }, balance: { entitled: 0, taken: 0, pending: 1, available: 0, applicable: -1 } }],
      overBalance: "WARN",
      lateReason: "",
      overlappingDates: new Set<string>(),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
      uncounted: true,
      teamAwayCount: 0,
      teamSize: 5,
    });
    const said = [...result.errors, ...result.warnings].join(" ");
    check("a negative balance is never quoted back at the applicant", !/-1/.test(said), said);
    check("and the application is not refused over it", result.ok === true);
  }

  // ---------------------------------------------------------------------
  console.log("\n13 · Maternity leave is not offered to every employee");
  // ---------------------------------------------------------------------
  const maternity = await prisma.leaveType.findUnique({ where: { code: "MATERNITY" } });
  check("the seeded type is marked for women", maternity?.appliesTo === "FEMALE");
  check("a man is not offered it", audienceIncludes("FEMALE", "Male") === false);
  check("a woman is", audienceIncludes("FEMALE", "Female") === true);
  check(
    "somebody whose gender is not recorded still is — the safer of the two mistakes",
    audienceIncludes("FEMALE", "") === true,
  );
  check(
    "an unrecognised value shows every type rather than none",
    audienceIncludes(undefined, "Male") === true,
  );
  check(
    "[source] it is asked of the column, never of the code MATERNITY",
    !/["']MATERNITY["']/.test(source("lib/leave.ts")) &&
      !/["']MATERNITY["']/.test(source("lib/leave-service.ts")),
  );

  // ---------------------------------------------------------------------
  console.log("\n14 · Dates in messages are written the way people write them");
  // ---------------------------------------------------------------------
  {
    const from = calendarDate(2026, 10, 19);
    const result = preflight({
      from,
      to: from,
      today: calendarDate(2026, 9, 1),
      days: planLeaveDays(from, from, new Set()),
      balances: [{ period: { from: calendarDate(2026, 1, 1), to: calendarDate(2026, 12, 31) }, balance: { entitled: 10, taken: 0, pending: 0, available: 10, applicable: 10 } }],
      overBalance: "REFUSE",
      lateReason: "",
      overlappingDates: new Set(["2026-10-19"]),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 5,
    });
    const clash = result.errors.find((e) => /already applied/.test(e)) ?? "";
    check(`the overlap message reads "${clash}"`, /19 Oct 2026/.test(clash));
    check("and never shows the ISO form", !/2026-10-19/.test(clash));
  }

  // ---------------------------------------------------------------------
  console.log("\n15 · Find anybody does not scroll sideways on a phone");
  // ---------------------------------------------------------------------
  check(
    "[source] the wide column can shrink, so the table scrolls instead of the page",
    /className="min-w-0"/.test(source("app/hr/employees/page.tsx")),
  );
  check(
    "[source] and every table's scroll box can shrink, wherever it is put",
    /min-w-0 overflow-x-auto/.test(source("components/ui/Table.tsx")),
  );

  // ---------------------------------------------------------------------
  console.log("\n16 · A replacement password can actually be issued (§4)");
  // ---------------------------------------------------------------------
  check(
    "[source] the employee file offers it — the place both screens point people to",
    /<ReissuePassword/.test(source("app/hr/employees/[id]/page.tsx")),
  );
  check(
    "[source] and the joiners queue offers it beside the Password expired badge",
    /<ReissuePassword/.test(source("app/hr/joiners/page.tsx")),
  );
  check(
    "[source] gated on the capability the action itself checks",
    /can\(context\.viewer, "accounts\.create"\)/.test(source("app/hr/joiners/page.tsx")) &&
      /can\(context\.viewer, "accounts\.create"\)/.test(source("app/hr/employees/[id]/page.tsx")),
  );

  // ---------------------------------------------------------------------
  console.log("\n17 · Every requisition reaches the Super Admin, and somebody actions it (§7.2)");
  // ---------------------------------------------------------------------
  // FCSL, 1 October 2026. The ৳50,000 threshold is gone: it decided nothing
  // for three of the four types, which carry no amount at all, so the Super
  // Admin saw only the expensive ones. And an approval is no longer where a
  // requisition ends — the HR Head names a department on the way up, and that
  // department's head closes it when the thing has actually arrived.
  const reqRaiser = await fixture("qa-reg-raiser@qa.fcsl.invalid", "QA Raiser", {});
  const reqHead = await fixture("qa-reg-hrhead@qa.fcsl.invalid", "QA HR Head", {});
  const reqIt = await fixture("qa-reg-ithead@qa.fcsl.invalid", "QA IT Head", {});
  // The notification check below asks who holds the HR_HEAD role, so one of
  // these fixtures has to actually hold it.
  await prisma.user.update({ where: { id: reqHead.userId }, data: { role: "HR_HEAD" } });

  const itDepartment = await prisma.department.create({
    data: { name: QA_DEPARTMENT, headId: reqIt.employeeId },
  });
  requisitionDepartmentId = itDepartment.id;

  // No amount at all — the case the old threshold could never route.
  const laptop = await prisma.requisition.create({
    data: {
      raisedById: reqRaiser.employeeId,
      raisedByName: "QA Raiser",
      type: "IT_EQUIPMENT",
      details: { item: "One laptop" },
      status: "PENDING",
      currentStep: 0,
      currentApproverRole: "HR_HEAD",
    },
  });

  const headActor = {
    userId: reqHead.userId,
    role: "HR_HEAD" as const,
    employeeId: reqHead.employeeId,
    name: "QA HR Head",
  };
  const adminActor = {
    userId: reqHead.userId,
    role: "SUPER_ADMIN" as const,
    employeeId: reqHead.employeeId,
    name: "QA Super Admin",
  };

  const noDepartment = await decideRequisition(headActor, laptop.id, "APPROVE", "Fine.");
  check(
    "the HR Head cannot approve without saying who will action it",
    "error" in noDepartment,
    JSON.stringify(noDepartment),
  );
  check(
    "and nothing moved",
    (await prisma.requisition.findUniqueOrThrow({ where: { id: laptop.id } }))
      .currentApproverRole === "HR_HEAD",
  );

  const named = await decideRequisition(
    headActor,
    laptop.id,
    "APPROVE",
    "Fine.",
    "",
    itDepartment.id,
  );
  const afterHead = await prisma.requisition.findUniqueOrThrow({ where: { id: laptop.id } });
  check(
    "a requisition with no amount still goes on to the Super Admin",
    "ok" in named && named.outcome === "passed" && afterHead.currentApproverRole === "SUPER_ADMIN",
    "ok" in named ? named.outcome : named.error,
  );
  check(
    "the department is written onto the row, name and all",
    afterHead.actionDepartmentId === itDepartment.id &&
      afterHead.actionDepartmentName === QA_DEPARTMENT,
    `${afterHead.actionDepartmentId} / ${afterHead.actionDepartmentName}`,
  );

  const beforeFinal = new Date();
  await decideRequisition(adminActor, laptop.id, "APPROVE", "Approved.");
  const toldAbout = await prisma.notification.findMany({
    where: { createdAt: { gte: beforeFinal } },
    select: { userId: true },
  });
  const timesTold = (userId: string) => toldAbout.filter((n) => n.userId === userId).length;
  check("the raiser is told", timesTold(reqRaiser.userId) === 1, String(timesTold(reqRaiser.userId)));
  check("the HR Head is told", timesTold(reqHead.userId) === 1, String(timesTold(reqHead.userId)));
  check(
    "and so is the head of the department that now has to do something",
    timesTold(reqIt.userId) === 1,
    String(timesTold(reqIt.userId)),
  );

  const byStranger = await fulfilRequisition(
    { userId: reqRaiser.userId, role: "EMPLOYEE", employeeId: reqRaiser.employeeId, name: "QA Raiser" },
    laptop.id,
    "",
    false,
  );
  check("somebody with no claim on it cannot close it", "error" in byStranger);

  const byDepartmentHead = await fulfilRequisition(
    { userId: reqIt.userId, role: "EMPLOYEE", employeeId: reqIt.employeeId, name: "QA IT Head" },
    laptop.id,
    "Handed over",
    false,
  );
  check(
    "the department head closes it, holding no approval capability at all",
    "ok" in byDepartmentHead,
    JSON.stringify(byDepartmentHead),
  );
  check(
    "and it is delivered",
    (await prisma.requisition.findUniqueOrThrow({ where: { id: laptop.id } })).status === "FULFILLED",
  );

  // One person, two reasons to be told, one bell item. A department head who
  // raises a requisition for their own department is the ordinary case of it.
  await prisma.department.update({
    where: { id: itDepartment.id },
    data: { headId: reqRaiser.employeeId },
  });
  const ownRequest = await prisma.requisition.create({
    data: {
      raisedById: reqRaiser.employeeId,
      raisedByName: "QA Raiser",
      type: "OFFICE_SUPPLIES",
      details: { item: "Printer paper", quantity: "20" },
      status: "PENDING",
      currentStep: 0,
      currentApproverRole: "HR_HEAD",
    },
  });
  await decideRequisition(headActor, ownRequest.id, "APPROVE", "Fine.", "", itDepartment.id);
  const beforeSecond = new Date();
  await decideRequisition(adminActor, ownRequest.id, "APPROVE", "Approved.");
  const secondRound = await prisma.notification.findMany({
    where: { createdAt: { gte: beforeSecond }, userId: reqRaiser.userId },
  });
  check(
    "raiser and department head in one person is told once, not twice",
    secondRound.length === 1,
    String(secondRound.length),
  );

  check(
    "[source] the route is decided by who raised it and nothing else",
    /requisitionChain\(raiserRole: Role\)/.test(source("lib/approval-chain.ts")),
  );
  check(
    "[source] no screen reads the retired threshold any more",
    !/escalationThreshold/.test(source("app/actions/requisitions.ts")) &&
      !/escalationThreshold/.test(source("components/approvals/RequisitionInbox.tsx")),
  );

  // ---------------------------------------------------------------------
  console.log("\n18 · Leave across a leave-year boundary is priced and paid for by both years");
  // ---------------------------------------------------------------------
  check("both years of a Christmas week are seen", yearsSpanned(
    calendarDate(2026, 12, 28),
    calendarDate(2027, 1, 4),
  ).join() === "2026,2027");

  const holidayName = "QA regression New Year holiday";
  await prisma.holiday.deleteMany({ where: { name: holidayName } });
  await prisma.holiday.create({
    data: { date: calendarDate(2027, 1, 4), name: holidayName, year: 2027 },
  });
  const spanning = await calendarForRange(calendarDate(2026, 12, 28), calendarDate(2027, 1, 4));
  const oneYearOnly = await calendarForRange(calendarDate(2026, 12, 28), calendarDate(2026, 12, 31));
  check(
    "next January's public holiday is known to a December application",
    spanning.holidays.has("2027-01-04") && !oneYearOnly.holidays.has("2027-01-04"),
  );

  const crosser = await fixture("qa-reg-crosser@qa.fcsl.invalid", "QA Crosser", {
    joiningDate: calendarDate(2020, 1, 1),
  });
  const crosserRow = (await prisma.employee.findUnique({ where: { id: crosser.employeeId } }))!;
  // Joined 1 January 2020, so this person's leave years still turn on 1 January.
  for (const period of leaveYearsSpanned(crosserRow.joiningDate, calendarDate(2026, 12, 28), calendarDate(2027, 1, 8))) {
    await ensureEntitlements(crosserRow, period.from);
  }
  const casualType = (await prisma.leaveType.findFirst({ where: { code: "CASUAL" } }))!;
  const days2027 = await prisma.leaveEntitlement.count({
    where: {
      employeeId: crosser.employeeId,
      leaveTypeId: casualType.id,
      fromDate: calendarDate(2027, 1, 1),
    },
  });
  check("next year's entitlement exists before the leave is decided", days2027 === 1);

  const planned = planLeaveDays(
    calendarDate(2026, 12, 28),
    calendarDate(2027, 1, 8),
    spanning.holidays,
    spanning.halfDayHolidays,
    spanning.weeklyOffDays,
  );
  const crossRequest = await prisma.leaveRequest.create({
    data: {
      employeeId: crosser.employeeId,
      leaveTypeId: casualType.id,
      reason: "regression",
      status: "GRANTED",
      currentStep: 0,
      days: {
        create: planned.map((d) => ({
          employeeId: crosser.employeeId,
          leaveTypeId: casualType.id,
          date: d.date,
          dayKind: d.dayKind,
          lengthDays: d.lengthDays,
        })),
      },
    },
  });
  const { shortfall: crossShortfall } = await prisma.$transaction((tx) =>
    consumeEntitlement(tx, crossRequest.id),
  );
  check(
    `every one of the ${workingDayCost(planned)} working days came off a balance`,
    crossShortfall === 0,
    `${crossShortfall} unfunded`,
  );
  const drawn2027 = await prisma.leaveDayEntitlement.aggregate({
    where: {
      leaveDay: { leaveRequestId: crossRequest.id },
      entitlement: { fromDate: calendarDate(2027, 1, 1) },
    },
    _sum: { lengthDays: true },
  });
  check(
    "and January's days came out of January's year, not December's",
    Number(drawn2027._sum.lengthDays ?? 0) > 0,
    `${Number(drawn2027._sum.lengthDays ?? 0)} days drawn from 2027`,
  );
  await prisma.holiday.deleteMany({ where: { name: holidayName } });

  // ---------------------------------------------------------------------
  console.log("\n19 · An exit can be undone (§6.6)");
  // ---------------------------------------------------------------------
  const returner = await fixture("qa-reg-returner@qa.fcsl.invalid", "QA Returner", {});
  await prisma.exit.create({
    data: {
      employeeId: returner.employeeId,
      reason: "RESIGNATION",
      lastWorkingDay: calendarDate(2026, 9, 1),
      documentsPurgeAfter: calendarDate(2027, 9, 1),
      recordedByName: "qa",
      completedAt: new Date(),
      completedByName: "qa",
    },
  });
  await prisma.employee.update({
    where: { id: returner.employeeId },
    data: { status: "LEFT", lastWorkingDay: calendarDate(2026, 9, 1) },
  });
  await prisma.user.update({ where: { id: returner.userId }, data: { disabledAt: new Date() } });

  const admin = await fixture("qa-reg-sa@qa.fcsl.invalid", "QA Regression Super Admin", {});
  const blockedFirst = await enableAccountAs(
    { userId: admin.userId, role: "SUPER_ADMIN", name: "QA Regression Super Admin" },
    returner.userId,
    "They withdrew their resignation.",
  );
  check(
    "re-enabling is still refused while they are marked as having left",
    "error" in blockedFirst,
  );

  // The action itself needs a request, so the reversal is done the way it does
  // it and then checked. The source check below pins the action to this shape.
  await prisma.$transaction(async (tx) => {
    await tx.exit.update({
      where: { employeeId: returner.employeeId },
      data: { reversedAt: new Date(), reversedByName: "qa", reversalReason: "Withdrew it." },
    });
    await tx.employee.update({
      where: { id: returner.employeeId },
      data: { status: "ACTIVE", lastWorkingDay: null },
    });
  });
  const nowAllowed = await enableAccountAs(
    { userId: admin.userId, role: "SUPER_ADMIN", name: "QA Regression Super Admin" },
    returner.userId,
    "They withdrew their resignation.",
  );
  check("and allowed once the exit is undone", "ok" in nowAllowed, JSON.stringify(nowAllowed));
  check(
    "the exit is kept on the record, marked undone, never deleted",
    (await prisma.exit.count({ where: { employeeId: returner.employeeId } })) === 1,
  );

  const exitFile = source("app/actions/hr-exit.ts");
  // Scoped to reverseExit: `disabledAt: null` appears elsewhere in this file
  // as a FILTER on who to notify, and matching that proves nothing.
  const exitSource = exitFile.slice(exitFile.indexOf("export async function reverseExit"));
  check(
    "[source] reverseExit demands a reason and leaves the account to the Super Admin",
    /export async function reverseExit/.test(exitSource) &&
      /Say why the exit is being undone/.test(exitSource) &&
      !/disabledAt/.test(exitSource),
  );
  check(
    "[source] a fresh exit can be recorded after one is undone",
    /if \(employee\.exit && !employee\.exit\.reversedAt\)/.test(exitFile),
  );
  check(
    "[source] it refuses once the documents have been purged",
    /documentsPurgedAt/.test(exitSource),
  );

  // ---------------------------------------------------------------------
  console.log("\n20 · Unused earned leave carries into next year (§12.2)");
  // ---------------------------------------------------------------------
  check("what carries is what was left, capped", carriedForwardDays(20, 5, 40) === 15);
  const earned = (await prisma.leaveType.findFirst({
    where: { code: "EARNED" },
    include: { rules: true },
  }))!;
  check(
    "earned leave no longer carries forward (FCSL, 10 September 2026)",
    earned.rules.length > 0 && earned.rules.every((rule) => !rule.carryForward),
  );
  // The mechanism, on a type of our own that does carry — so this check
  // outlives whatever FCSL next decides about earned leave.
  const carrying = await prisma.leaveType.create({
    data: {
      name: "QA carrying leave",
      code: "QA_REG_CARRY",
      rules: {
        create: [
          {
            effectiveFrom: calendarDate(2020, 1, 1),
            daysPerYear: 20,
            carryForward: true,
            carryForwardCap: 40,
            createdByName: "qa",
          },
        ],
      },
    },
  });
  carryLeaveTypeId = carrying.id;
  const carrier = await fixture("qa-reg-carrier@qa.fcsl.invalid", "QA Carrier", {
    joiningDate: calendarDate(2020, 1, 1),
  });
  const carrierRow = (await prisma.employee.findUnique({ where: { id: carrier.employeeId } }))!;
  await ensureEntitlements(carrierRow, calendarDate(2026, 6, 1));
  const granted2026 = await prisma.leaveEntitlement.findFirst({
    where: {
      employeeId: carrier.employeeId,
      leaveTypeId: carrying.id,
      fromDate: calendarDate(2026, 1, 1),
      source: "GRANT",
    },
  });
  await ensureEntitlements(carrierRow, calendarDate(2027, 6, 1));
  const carriedBucket = await prisma.leaveEntitlement.findFirst({
    where: {
      employeeId: carrier.employeeId,
      leaveTypeId: carrying.id,
      fromDate: calendarDate(2027, 1, 1),
      source: "CARRY_FORWARD",
    },
  });
  check(
    "a carry-forward bucket is created for a type that carries",
    carriedBucket !== null && Number(carriedBucket.days) === Number(granted2026?.days ?? 0),
    `carried ${Number(carriedBucket?.days ?? 0)} of ${Number(granted2026?.days ?? 0)}`,
  );
  check(
    "and none for earned leave, which does not",
    (await prisma.leaveEntitlement.count({
      where: { employeeId: carrier.employeeId, leaveTypeId: earned.id, source: "CARRY_FORWARD" },
    })) === 0,
  );
  // Idempotent: opening the page twice must not double it.
  await ensureEntitlements(carrierRow, calendarDate(2027, 6, 1));
  check(
    "running it again does not carry the days a second time",
    (await prisma.leaveEntitlement.count({
      where: { employeeId: carrier.employeeId, leaveTypeId: carrying.id, source: "CARRY_FORWARD" },
    })) === 1,
  );

  // ---------------------------------------------------------------------
  console.log("\n20b · Probation, worked through FCSL's own example (10 September 2026)");
  // ---------------------------------------------------------------------
  const probationer = await fixture("qa-reg-probation@qa.fcsl.invalid", "QA Probationer", {
    joiningDate: calendarDate(2026, 1, 1),
  });
  const probationerRow = (await prisma.employee.findUnique({ where: { id: probationer.employeeId } }))!;
  const sickType = (await prisma.leaveType.findFirst({ where: { code: "SICK" } }))!;
  await ensureEntitlements(probationerRow, calendarDate(2026, 3, 1));
  const takeGranted = async (leaveTypeId: string, first: Date, last: Date) => {
    const planned = planLeaveDays(first, last, new Set());
    const request = await prisma.leaveRequest.create({
      data: {
        employeeId: probationer.employeeId,
        leaveTypeId,
        reason: "regression",
        status: "GRANTED",
        currentStep: 0,
        days: {
          create: planned.map((day) => ({
            employeeId: probationer.employeeId,
            leaveTypeId,
            date: day.date,
            dayKind: day.dayKind,
            lengthDays: day.lengthDays,
          })),
        },
      },
    });
    return prisma.$transaction((tx) => consumeEntitlement(tx, request.id));
  };
  // "joined 3 months ago and need 3 days leave" — Monday 6 to Wednesday 8 April.
  const casualTaken = await takeGranted(casualType.id, calendarDate(2026, 4, 6), calendarDate(2026, 4, 8));
  // "after 7 months of working I got 2 days sick leave" — Monday 3 and Tuesday 4 August.
  const sickTaken = await takeGranted(sickType.id, calendarDate(2026, 8, 3), calendarDate(2026, 8, 4));
  check(
    "leave taken in probation is paid for, not refused",
    casualTaken.shortfall === 0 && sickTaken.shortfall === 0,
    `${casualTaken.shortfall} casual and ${sickTaken.shortfall} sick unfunded`,
  );
  const duringProbation = await leaveTypesFor(probationerRow, calendarDate(2026, 9, 1));
  check(
    "during probation the balance already shows what is left of the first permanent year",
    duringProbation.find((type) => type.code === "CASUAL")?.balance.available === 3,
  );
  check(
    "earned leave is closed during probation and names the day it opens",
    duringProbation.find((type) => type.code === "EARNED")?.availableFrom?.getTime() ===
      calendarDate(2027, 1, 1).getTime(),
  );

  await ensureEntitlements(probationerRow, calendarDate(2027, 3, 1));
  const firstPermanent = await leaveTypesFor(probationerRow, calendarDate(2027, 3, 1));
  const left = (code: string) => firstPermanent.find((type) => type.code === code)?.balance.available;
  check(`"that year I will only have 3 casual leave"`, left("CASUAL") === 3, String(left("CASUAL")));
  check(`"and will have 4 sick leaves"`, left("SICK") === 4, String(left("SICK")));
  check("and earned leave has opened in full", left("EARNED") === 20, String(left("EARNED")));
  check(
    "one advance bucket, not one per year",
    (await prisma.leaveEntitlement.count({
      where: { employeeId: probationer.employeeId, leaveTypeId: casualType.id, source: "GRANT" },
    })) === 1,
  );

  await ensureEntitlements(probationerRow, calendarDate(2028, 3, 1));
  const yearAfter = await leaveTypesFor(probationerRow, calendarDate(2028, 3, 1));
  const after = (code: string) => yearAfter.find((type) => type.code === code)?.balance.available;
  check(`"Next year I'll have all 6, 6"`, after("CASUAL") === 6 && after("SICK") === 6, `${after("CASUAL")}, ${after("SICK")}`);

  // ---------------------------------------------------------------------
  console.log("\n21 · The database holds the rules the code only checked (§6.9, §5.1)");
  // ---------------------------------------------------------------------
  const probeTerminal = await prisma.tradingTerminal.create({
    data: { terminalId: "QA-REG-IDX", exchange: "DSE", status: "ACTIVE" },
  });
  const holderA = await fixture("qa-reg-holder-a@qa.fcsl.invalid", "QA Holder A", {});
  const holderB = await fixture("qa-reg-holder-b@qa.fcsl.invalid", "QA Holder B", {});
  await prisma.terminalAssignment.create({
    data: {
      terminalId: probeTerminal.id,
      employeeId: holderA.employeeId,
      assignedOn: calendarDate(2026, 1, 1),
      assignedByName: "qa",
    },
  });
  let secondHolderRefused = false;
  try {
    await prisma.terminalAssignment.create({
      data: {
        terminalId: probeTerminal.id,
        employeeId: holderB.employeeId,
        assignedOn: calendarDate(2026, 1, 1),
        assignedByName: "qa",
      },
    });
  } catch {
    secondHolderRefused = true;
  }
  check("one trading terminal cannot be held by two people at once", secondHolderRefused);

  // History must still accumulate: a released assignment plus a live one.
  await prisma.terminalAssignment.updateMany({
    where: { terminalId: probeTerminal.id, releasedOn: null },
    data: { releasedOn: calendarDate(2026, 6, 1) },
  });
  await prisma.terminalAssignment.create({
    data: {
      terminalId: probeTerminal.id,
      employeeId: holderB.employeeId,
      assignedOn: calendarDate(2026, 7, 1),
      assignedByName: "qa",
    },
  });
  check(
    "but a released assignment beside a live one is still allowed — that is history",
    (await prisma.terminalAssignment.count({ where: { terminalId: probeTerminal.id } })) === 2,
  );

  let secondContactRefused = false;
  await prisma.emergencyContact.create({
    data: {
      employeeId: holderA.employeeId,
      slot: 1,
      name: "First",
      relationship: "Brother",
      mobile: "01711111111",
      status: "CURRENT",
    },
  });
  try {
    await prisma.emergencyContact.create({
      data: {
        employeeId: holderA.employeeId,
        slot: 1,
        name: "Second",
        relationship: "Sister",
        mobile: "01722222222",
        status: "CURRENT",
      },
    });
  } catch {
    secondContactRefused = true;
  }
  check("only one current emergency contact per slot", secondContactRefused);
  await prisma.emergencyContact.updateMany({
    where: { employeeId: holderA.employeeId },
    data: { status: "SUPERSEDED" },
  });
  check(
    "superseded ones are unconstrained — keeping every version is the point",
    (await prisma.emergencyContact.count({ where: { employeeId: holderA.employeeId } })) === 1,
  );
  await prisma.terminalAssignment.deleteMany({ where: { terminalId: probeTerminal.id } });
  await prisma.tradingTerminal.delete({ where: { id: probeTerminal.id } });

  // ---------------------------------------------------------------------
  console.log("\n22 · An attendance sheet lists only people who were here (§6.3)");
  // ---------------------------------------------------------------------
  const probeBranch = await prisma.branch.create({
    data: { name: "QA Reg Branch", code: "QRB", openedOn: calendarDate(2020, 1, 1) },
  });
  const lateJoiner = await fixture("qa-reg-late@qa.fcsl.invalid", "QA Late Joiner", {
    branchId: probeBranch.id,
    joiningDate: calendarDate(2026, 9, 1),
  });
  void lateJoiner;
  const januaryFirst = calendarDate(2026, 1, 1);
  const januaryLast = calendarDate(2026, 1, 31);
  const onJanuary = await prisma.employee.findMany({
    where: {
      branchId: probeBranch.id,
      onboardingStatus: "APPROVED",
      AND: [
        { OR: [{ status: "ACTIVE" }, { lastWorkingDay: { gte: januaryFirst } }] },
        { OR: [{ joiningDate: null }, { joiningDate: { lte: januaryLast } }] },
      ],
    },
    select: { id: true },
  });
  check("a September joiner is not on January's sheet", onJanuary.length === 0);
  const onSeptember = await prisma.employee.findMany({
    where: {
      branchId: probeBranch.id,
      onboardingStatus: "APPROVED",
      AND: [
        { OR: [{ status: "ACTIVE" }, { lastWorkingDay: { gte: calendarDate(2026, 9, 1) } }] },
        { OR: [{ joiningDate: null }, { joiningDate: { lte: calendarDate(2026, 9, 30) } }] },
      ],
    },
    select: { id: true },
  });
  check("and is on September's", onSeptember.length === 1);
  check(
    "[source] the grid and the save ask the same question",
    /joiningDate: \{ lte: last \}/.test(source("app/team/attendance/page.tsx")) &&
      /joiningDate: \{ lte: lastOfMonth \}/.test(source("app/actions/attendance.ts")),
  );
  await prisma.branch.delete({ where: { id: probeBranch.id } });

  // ---------------------------------------------------------------------
  console.log("\n23 · Leave has a maximum length, and the HR Head sets it");
  // ---------------------------------------------------------------------
  const maxSetting = await prisma.setting.findUnique({ where: { key: "leave.maximumDays" } });
  check("the setting is seeded", maxSetting?.value === "366", String(maxSetting?.value));
  check("and a missing or silly value falls back to a year", maximumLeaveDays(null) === 366 && maximumLeaveDays("0") === 366);
  {
    const from = calendarDate(2026, 10, 1);
    const to = calendarDate(2126, 10, 1);
    const result = preflight({
      from,
      to,
      today: calendarDate(2026, 9, 1),
      days: planLeaveDays(from, to, new Set()),
      balances: [{ period: { from: calendarDate(2026, 1, 1), to: calendarDate(2026, 12, 31) }, balance: { entitled: 0, taken: 0, pending: 0, available: 0, applicable: 0 } }],
      overBalance: "WARN",
      lateReason: "",
      overlappingDates: new Set<string>(),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      maximumDays: maximumLeaveDays(maxSetting?.value),
      uncounted: true,
      teamAwayCount: 0,
      teamSize: 5,
    });
    check("a hundred-year application is refused", !result.ok);
    check(
      "and told plainly how long it was",
      result.errors.some((e) => /36525 days/.test(e)),
      result.errors[0],
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n24 · Losing a race is a sentence, not a crash");
  // ---------------------------------------------------------------------
  check(
    "[source] the leave decision catches the constraint that holds the rule",
    /if \(lostTheRace\(error\)\) return null/.test(source("lib/leave-decide.ts")) &&
      /This has already been decided/.test(source("lib/leave-decide.ts")),
  );
  check(
    "[source] and so does the requisition decision",
    /if \(lostTheRace\(error\)\) return null/.test(source("lib/requisition-decide.ts")),
  );
  check(
    "[source] and assigning a terminal",
    /assigned to somebody else a moment ago/.test(source("app/actions/hr-registers.ts")),
  );

  // ---------------------------------------------------------------------
  console.log("\n25 · Requisitions can be withdrawn and marked delivered (§6.2, §6.4)");
  // ---------------------------------------------------------------------
  const requisitionsPage = source("app/team/requisitions/page.tsx");
  check("[source] a withdraw button exists", /<WithdrawRequisition/.test(requisitionsPage));
  check("[source] and a mark-delivered one", /<MarkDelivered/.test(requisitionsPage));
  check(
    "[source] the delivery list is gated on the capability the action checks",
    /can\(context\.viewer, "requisitions\.approve"\)/.test(requisitionsPage),
  );

  // ---------------------------------------------------------------------
  console.log("\n26 · HR can correct a balance in either direction (§6.2)");
  // ---------------------------------------------------------------------
  const adjusted = await fixture("qa-reg-adjust@qa.fcsl.invalid", "QA Adjusted", {
    joiningDate: calendarDate(2020, 1, 1),
  });
  const adjustedRow = (await prisma.employee.findUnique({ where: { id: adjusted.employeeId } }))!;
  await ensureEntitlements(adjustedRow, calendarDate(2026, 6, 1));
  const before = (await leaveTypesFor(adjustedRow, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;
  await prisma.leaveEntitlement.create({
    data: {
      employeeId: adjusted.employeeId,
      leaveTypeId: before.id,
      fromDate: calendarDate(2026, 1, 1),
      toDate: calendarDate(2026, 12, 31),
      days: -3,
      source: "ADJUSTMENT",
      note: "Regression: days taken outside the system.",
      createdByName: "qa",
    },
  });
  const afterDown = (await leaveTypesFor(adjustedRow, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;
  check(
    `taking days away lowers what is entitled — ${before.balance.entitled} to ${afterDown.balance.entitled}`,
    afterDown.balance.entitled === before.balance.entitled - 3,
  );
  await prisma.leaveEntitlement.create({
    data: {
      employeeId: adjusted.employeeId,
      leaveTypeId: before.id,
      fromDate: calendarDate(2026, 1, 1),
      toDate: calendarDate(2026, 12, 31),
      days: 5,
      source: "ADJUSTMENT",
      note: "Regression: agreed with the HR Head.",
      createdByName: "qa",
    },
  });
  const afterUp = (await leaveTypesFor(adjustedRow, calendarDate(2026, 6, 1))).find((t) => t.code === "CASUAL")!;
  check("and adding days raises it", afterUp.balance.entitled === before.balance.entitled + 2);
  check(
    "the grant itself is untouched — adjustments are new rows, never edits",
    (await prisma.leaveEntitlement.count({
      where: { employeeId: adjusted.employeeId, leaveTypeId: before.id, source: "GRANT" },
    })) === 1,
  );
  check(
    "[source] a written reason is demanded",
    /Say why\. This is read whenever somebody asks about their balance/.test(
      source("app/actions/hr-setup.ts"),
    ),
  );

  // ---------------------------------------------------------------------
  console.log("\n27 · The release letter is produced and filed (§6.6)");
  // ---------------------------------------------------------------------
  const draft = releaseLetterTemplate({
    fullName: "QA Leaver",
    designation: "Associate",
    joiningDate: "12 Jan 2021",
    lastWorkingDay: "30 Sept 2026",
    reason: "RESIGNATION",
  });
  check("the draft names the person, the role and both dates",
    draft.includes("QA Leaver") && draft.includes("Associate") &&
      draft.includes("12 Jan 2021") && draft.includes("30 Sept 2026"));
  check(
    "and claims nothing about their conduct, which the system does not know",
    !/excellent|satisfactor|good conduct|recommend/i.test(draft),
  );
  const letterBytes = await releaseLetterPdf({
    employeeName: "QA Leaver",
    employeeCode: "A 118 - 21 - 70",
    designation: "Associate",
    joiningDate: "12 Jan 2021",
    lastWorkingDay: "30 Sept 2026",
    body: draft,
    issuedByName: "QA HR",
    issuedOn: "8 Sept 2026",
  });
  check("it becomes a real PDF", Buffer.from(letterBytes.slice(0, 5)).toString() === "%PDF-");
  const exitSourceForLetter = source("app/actions/hr-exit.ts");
  check(
    "[source] the file is written before the row that points at it",
    exitSourceForLetter.indexOf("await putObject(key, bytes") <
      exitSourceForLetter.indexOf("releaseLetterDocumentId: document.id"),
  );
  check(
    "[source] and HR edits the wording before it is produced",
    /value=\{body\}/.test(source("components/hr/ReleaseLetter.tsx")) &&
      /Read it\s*\n?\s*before you issue it|Read it before you issue it/.test(
        source("components/hr/ReleaseLetter.tsx"),
      ),
  );

  // ---------------------------------------------------------------------
  console.log("\n28 · The permanent record says WHICH one was retired");
  // ---------------------------------------------------------------------
  check(
    "[source] the retirement line carries the name, not the word \"department\"",
    /targetLabel: `\$\{named\.name\} \(\$\{kind\}\)`/.test(source("app/actions/hr-settings.ts")),
  );

  // ---------------------------------------------------------------------
  console.log("\n29 · Uploads are shrunk without becoming unreadable (§6.1)");
  // ---------------------------------------------------------------------
  const madeUp = async (w: number, h: number, quality = 92) => {
    const px = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 3;
        px[i] = (x * 255) / w;
        px[i + 1] = (y * 255) / h;
        px[i + 2] = ((x ^ y) % 97) * 2;
      }
    }
    return new Uint8Array(
      await sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality }).toBuffer(),
    );
  };

  const phonePhoto = await madeUp(4032, 3024);
  const shrunk = await compressUpload(phonePhoto, "image/jpeg");
  check(
    `a 12-megapixel photograph shrinks — ${savingLine(phonePhoto.length, shrunk.bytes.length)}`,
    shrunk.changed && shrunk.bytes.length < phonePhoto.length,
  );
  const shrunkMeta = await sharp(shrunk.bytes).metadata();
  check(
    `and stays big enough to read — ${shrunkMeta.width}x${shrunkMeta.height}`,
    Math.max(shrunkMeta.width ?? 0, shrunkMeta.height ?? 0) === MAX_EDGE,
  );

  const portrait = await compressUpload(await madeUp(3024, 4032), "image/jpeg", PORTRAIT_EDGE);
  const portraitMeta = await sharp(portrait.bytes).metadata();
  check(
    "a passport photograph is held to a smaller size still",
    Math.max(portraitMeta.width ?? 0, portraitMeta.height ?? 0) === PORTRAIT_EDGE,
  );

  // The trap: a phone writes rotation into EXIF and leaves the pixels alone.
  // Strip the tag without applying it and every portrait lands sideways.
  const sideways = new Uint8Array(
    await sharp({ create: { width: 1200, height: 600, channels: 3, background: "#6e1616" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer(),
  );
  const uprightMeta = await sharp((await compressUpload(sideways, "image/jpeg")).bytes).metadata();
  check(
    "a photograph the phone marked as rotated comes out the right way up",
    (uprightMeta.height ?? 0) > (uprightMeta.width ?? 0) && (uprightMeta.orientation ?? 1) === 1,
  );

  const pdfIn = new Uint8Array(Buffer.from("%PDF-1.7\nleave me alone\n"));
  const pdfOut = await compressUpload(pdfIn, "application/pdf");
  check(
    "a PDF is passed through byte for byte",
    !pdfOut.changed && Buffer.from(pdfOut.bytes).equals(Buffer.from(pdfIn)),
  );

  const alreadySmall = new Uint8Array(
    await sharp({ create: { width: 50, height: 50, channels: 3, background: "#ffffff" } })
      .jpeg({ quality: 20 })
      .toBuffer(),
  );
  check(
    "nothing is ever handed back bigger than it arrived",
    (await compressUpload(alreadySmall, "image/jpeg")).bytes.length <= alreadySmall.length,
  );

  const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const kept = await compressUpload(broken, "image/jpeg");
  check(
    "a file that cannot be read is kept, not lost",
    !kept.changed && kept.bytes.length === broken.length,
  );

  const uploadRoute = source("app/api/upload/route.ts");
  check(
    "[source] the row records what was STORED, not what was sent",
    /mimeType: shrunk\.type/.test(uploadRoute) && /size: shrunk\.bytes\.length/.test(uploadRoute),
  );
  check(
    "[source] and the filename follows it, so a converted PNG opens",
    /safeFileName\(file\.name, shrunk\.type\)/.test(uploadRoute),
  );

  // ---------------------------------------------------------------------
  console.log("\n30 · The brakes hold, and a failure is visible to somebody");
  // ---------------------------------------------------------------------
  // A key nothing in the running system can produce — the real ones are
  // `upload:<cuid>` and `export:<cuid>` — so this cannot throttle a real
  // person even if the cleanup below never runs.
  const brakeKey = `qa:brake:${Date.now()}`;
  try {
    check("an untouched key is not limited", (await isRateLimited(brakeKey, BURST)) === false);

    for (let i = 0; i < BURST.max; i += 1) await recordAttempt(brakeKey);
    check(
      `the brake engages at ${BURST.max} in ${BURST.windowMs / 60_000} minutes`,
      (await isRateLimited(brakeKey, BURST)) === true,
    );
    check(
      "one person hitting it does not limit anybody else",
      (await isRateLimited(`${brakeKey}:someone-else`, BURST)) === false,
    );
    // The whole point of the default argument. Giving the expensive endpoints
    // a limit of their own must not have loosened the one on the front door.
    check(
      "and sign-in still trips at its own, far lower, ten in fifteen minutes",
      SIGN_IN.max === 10 && SIGN_IN.windowMs === 15 * 60 * 1000,
    );
  } finally {
    await appPrisma.loginAttempt.deleteMany({ where: { key: { startsWith: brakeKey } } });
  }

  const exportRoute = source("app/api/export/route.ts");
  check(
    "[source] both brakes are keyed on the PERSON — a branch is one address, many people",
    /upload:\$\{context\.user\.id\}/.test(uploadRoute) &&
      /export:\$\{context\.user\.id\}/.test(exportRoute),
  );
  check(
    "[source] and the upload brake is checked before the body is read",
    uploadRoute.indexOf("isRateLimited") < uploadRoute.indexOf("request.formData()"),
  );

  const config = stripComments(source("next.config.ts"));
  check(
    "[source] every response carries HSTS, DENY, nosniff and a referrer policy",
    /Strict-Transport-Security/.test(config) &&
      /X-Frame-Options/.test(config) &&
      /X-Content-Type-Options/.test(config) &&
      /Referrer-Policy/.test(config) &&
      /frame-ancestors 'none'/.test(config),
  );
  check(
    "[source] HSTS is not preloaded — that is slow and awkward to undo",
    !/preload/.test(config),
  );

  const health = source("app/api/health/route.ts");
  check(
    "[source] health asks the DATABASE, not merely whether Next is running",
    /\$queryRaw/.test(health),
  );
  check(
    "[source] and its unauthenticated reply says nothing but ok",
    !/process\.env|version|hostname/.test(stripComments(health)),
  );

  const hook = stripComments(source("instrumentation.ts"));
  check(
    "[source] uncaught server errors reach the log under a findable marker",
    /onRequestError/.test(hook) && /fcsl-hrm:error/.test(hook),
  );
  // The one that matters: request headers carry the session cookie, and a log
  // line holding a live session is a way in for anybody who can read the log.
  check("[source] and no request header is ever logged", !/headers/.test(hook));

  // ---------------------------------------------------------------------
  console.log("\n31 · A note written for a day rings the bell that morning (10 September 2026)");
  // ---------------------------------------------------------------------
  {
    const writer = await fixture("qa-reg-notes@qa.fcsl.invalid", "QA Note Writer", {});
    const closed = await fixture("qa-reg-notes-off@qa.fcsl.invalid", "QA Closed Note Writer", {});
    await prisma.user.update({ where: { id: closed.userId }, data: { disabledAt: new Date() } });
    // A fixed day years ahead, so the run touches nobody's real notes.
    const day = calendarDate(2031, 3, 4);
    await prisma.note.createMany({
      data: [
        { userId: writer.userId, body: "Meeting with two people — bring the file.", date: day },
        { userId: writer.userId, body: "Second note.", date: day },
        { userId: writer.userId, body: "The day after.", date: addDays(day, 1) },
        { userId: closed.userId, body: "Nobody to tell.", date: day },
      ],
    });
    const bellFor = (userId: string) =>
      prisma.notification.findMany({ where: { userId, title: { contains: "note" } } });

    const firstRun = await runNoteReminders(day);
    const bell = await bellFor(writer.userId);
    check(
      "two notes on the same day make one bell item",
      bell.length === 1 && bell[0]!.title === "You have 2 notes for today",
      JSON.stringify(bell.map((b) => b.title)),
    );
    check("it carries none of the note's words", bell.every((b) => b.body === "" && !/Meeting/.test(b.title)));
    check(
      "it links to that day on the calendar",
      bell[0]?.link === "/me/calendar?m=2031-03&d=2031-03-04",
      bell[0]?.link,
    );
    check("and it never goes into the morning email", bell.every((b) => b.digestedAt !== null));
    check("a closed account is not reminded", (await bellFor(closed.userId)).length === 0);
    const secondRun = await runNoteReminders(day);
    check(
      "a second run the same morning rings nothing more",
      secondRun.acted === 0 && (await bellFor(writer.userId)).length === 1,
      JSON.stringify({ first: firstRun.acted, second: secondRun.acted }),
    );
    check(
      "[source] moving a note to another day clears its reminder",
      /NOT: \{ date \}[\s\S]{0,80}remindedAt: null/.test(source("app/actions/notes.ts")),
    );
    check(
      "[source] the reminder runs nightly, before the digest",
      /"notes",\s*\n\s*"digest"/.test(source("lib/jobs.ts")),
    );
  }

  console.log("\n33 · The Super Admin says whether leave is paid (FCSL, 1 October 2026)");
  {
    // FCSL's example, through the real approval chain rather than by calling
    // consumeEntitlement directly: "X joined 2025 January... if he takes 2 days
    // leave and it's paid leave it will deduct 2 days from 2026. And if that
    // leave is unpaid then nothing will be deducted."
    const joined = calendarDate(2025, 1, 15);
    const boss = await fixture("qa-pay-boss@qa.fcsl.invalid", "QA Pay Boss", {});
    await prisma.user.update({ where: { id: boss.userId }, data: { role: "MANAGER" } });

    const manager = {
      userId: boss.userId,
      role: "MANAGER" as const,
      employeeId: boss.employeeId,
      name: "QA Pay Boss",
    };
    const hrHead = { ...manager, role: "HR_HEAD" as const, name: "QA Pay HR" };
    const superAdmin = { ...manager, role: "SUPER_ADMIN" as const, name: "QA Pay Admin" };

    // Two people, same joining date, same two days off in probation. The only
    // difference is what the Super Admin says about pay.
    const take = async (email: string, name: string) => {
      const person = await fixture(email, name, { joiningDate: joined, managerId: boss.employeeId });
      const row = (await prisma.employee.findUniqueOrThrow({ where: { id: person.employeeId } }));
      await ensureEntitlements(row, calendarDate(2025, 4, 7));
      const planned = planLeaveDays(calendarDate(2025, 4, 7), calendarDate(2025, 4, 8), new Set());
      const request = await prisma.leaveRequest.create({
        data: {
          employeeId: person.employeeId,
          leaveTypeId: casualType.id,
          reason: "two days in probation",
          status: "PENDING",
          currentStep: 0,
          currentApproverRole: "MANAGER",
          days: {
            create: planned.map((day) => ({
              employeeId: person.employeeId,
              leaveTypeId: casualType.id,
              date: day.date,
              dayKind: day.dayKind,
              lengthDays: day.lengthDays,
            })),
          },
        },
      });
      await applyLeaveDecision(manager, request.id, "GRANT", "Fine.");
      await applyLeaveDecision(hrHead, request.id, "GRANT", "Agreed.");
      return { row, requestId: request.id };
    };

    const paidPerson = await take("qa-pay-paid@qa.fcsl.invalid", "QA Paid");
    const unpaidPerson = await take("qa-pay-unpaid@qa.fcsl.invalid", "QA Unpaid");

    const undecided = await applyLeaveDecision(
      superAdmin,
      paidPerson.requestId,
      "GRANT",
      "Approved.",
    );
    check(
      "the last step cannot grant without saying whether it is paid",
      "error" in undecided,
      JSON.stringify(undecided),
    );
    check(
      "and the application is untouched",
      (await prisma.leaveRequest.findUniqueOrThrow({ where: { id: paidPerson.requestId } }))
        .status === "PENDING",
    );

    await applyLeaveDecision(superAdmin, paidPerson.requestId, "GRANT", "Approved.", "", true);
    await applyLeaveDecision(superAdmin, unpaidPerson.requestId, "GRANT", "Approved.", "", false);

    const paidRow = await prisma.leaveRequest.findUniqueOrThrow({
      where: { id: paidPerson.requestId },
    });
    const unpaidRow = await prisma.leaveRequest.findUniqueOrThrow({
      where: { id: unpaidPerson.requestId },
    });
    check(
      "both are granted, and each row says which it was",
      paidRow.status === "GRANTED" && paidRow.paid === true &&
        unpaidRow.status === "GRANTED" && unpaidRow.paid === false,
      `${paidRow.paid} / ${unpaidRow.paid}`,
    );

    // The absence is recorded either way — the calendar and the attendance
    // sheet have to show it. Only the entitlement differs.
    check(
      "the unpaid absence is still on the record, day for day",
      (await prisma.leaveDay.count({ where: { leaveRequestId: unpaidPerson.requestId } })) === 2,
    );
    check(
      "but it is deducted from nothing — no entitlement row was written",
      (await prisma.leaveDayEntitlement.count({
        where: { leaveDay: { leaveRequestId: unpaidPerson.requestId } },
      })) === 0,
    );
    check(
      "while the paid days are deducted from the first permanent year",
      (await prisma.leaveDayEntitlement.count({
        where: { leaveDay: { leaveRequestId: paidPerson.requestId } },
      })) === 2,
    );

    // The year FCSL names: 2026, the first permanent one, running from the
    // joining anniversary.
    const firstPermanent = async (row: Awaited<ReturnType<typeof take>>["row"]) => {
      await ensureEntitlements(row, calendarDate(2026, 6, 1));
      const types = await leaveTypesFor(row, calendarDate(2026, 6, 1));
      return types.find((type) => type.code === "CASUAL")?.balance.available;
    };
    const paidLeft = await firstPermanent(paidPerson.row);
    const unpaidLeft = await firstPermanent(unpaidPerson.row);
    check(
      '"if it\'s paid leave it will deduct 2 days from 2026" — 4 of 6 left',
      paidLeft === 4,
      String(paidLeft),
    );
    check(
      '"and if that leave is unpaid then nothing will be deducted" — all 6 left',
      unpaidLeft === 6,
      String(unpaidLeft),
    );

    // Leave without pay has no entitlement to pay from, so calling it paid is
    // a record that contradicts itself.
    const unpaidType = (await prisma.leaveType.findFirstOrThrow({ where: { code: "UNPAID" } }));
    const lwp = await prisma.leaveRequest.create({
      data: {
        employeeId: paidPerson.row.id,
        leaveTypeId: unpaidType.id,
        reason: "no entitlement",
        status: "PENDING",
        currentStep: 2,
        currentApproverRole: "SUPER_ADMIN",
        days: {
          create: [
            {
              employeeId: paidPerson.row.id,
              leaveTypeId: unpaidType.id,
              date: calendarDate(2026, 5, 4),
              dayKind: "WORKING",
              lengthDays: 1,
            },
          ],
        },
      },
    });
    const wrongly = await applyLeaveDecision(superAdmin, lwp.id, "GRANT", "Approved.", "", true);
    check(
      "leave without pay cannot be granted WITH pay",
      "error" in wrongly && /cannot be granted with pay/.test(wrongly.error),
      JSON.stringify(wrongly),
    );
    const rightly = await applyLeaveDecision(superAdmin, lwp.id, "GRANT", "Approved.", "", false);
    check("but it grants without pay", "ok" in rightly, JSON.stringify(rightly));

    check(
      "[source] nothing is consumed unless it was granted with pay",
      /withPay\s*\n?\s*\? await consumeEntitlement/.test(source("lib/leave-decide.ts")),
    );
    check(
      "[source] and the email does not tell an unpaid person their balance moved",
      /Nothing has come off your leave balance/.test(source("lib/leave-decide.ts")),
    );
  }

  // ---------------------------------------------------------------------
  console.log("\n34 · The dry run names what matches nothing, before anything is written (§12.1)");
  {
    // The import resolves branch, department, designation and grade BY NAME and a
    // miss is silent — the person arrives with that field empty. Over 412 rows a
    // few typos would land as blanks nobody sees until a report is run.
    const onRecord = await fixture("qa-ref-boss@qa.fcsl.invalid", "QA Ref Boss", {
      employeeId: "A 777 - 20 - 70",
    });
    const refBranch = await prisma.branch.create({
      data: { name: "QA Ref Branch", code: "QAREF" },
    });
    const realGrade = (await prisma.grade.findFirstOrThrow({ where: { retiredAt: null } })).name;
    const realDepartment = (
      await prisma.department.findFirstOrThrow({ where: { retiredAt: null } })
    ).name;

    const refRow = (row: number, over: Partial<CheckedRow>): CheckedRow => ({
      row,
      employeeId: `A ${String(800 + row).padStart(3, "0")} - 20 - 70`,
      fullName: `QA Ref ${row}`,
      email: `qa-ref-${row}@qa.fcsl.invalid`,
      mobile: "",
      joiningDate: calendarDate(2020, 1, 1),
      confirmationDate: null,
      role: "EMPLOYEE",
      staffType: "STAFF",
      branch: "",
      department: "",
      designation: "",
      grade: "",
      manager: "",
      certificateNumber: "",
      certificateIssue: null,
      certificateExpiry: null,
      ...over,
    });

    try {
      const allGood = await unmatchedReferences([
        refRow(2, { grade: realGrade, department: realDepartment, branch: "QA Ref Branch" }),
        // Branches match on code as well as name, because whoever fills the
        // sheet in uses whichever they had to hand.
        refRow(3, { branch: "QAREF" }),
        // Blank is a decision, not a typo: these columns are optional.
        refRow(4, {}),
      ]);
      check(
        "a file naming real things, by name or by branch code, reports nothing",
        allGood.length === 0,
        JSON.stringify(allGood),
      );

      const typos = await unmatchedReferences([
        refRow(2, { grade: "AR1z" }),
        refRow(3, { grade: "AR1z" }),
        refRow(4, { grade: "ar1z" }),
        refRow(5, { designation: "Chief Wizard" }),
      ]);
      const gradeMiss = typos.find((u) => u.column === "Grade");
      check(
        "a misspelled grade is reported once, not once per row",
        typos.length === 2 && gradeMiss?.rows.length === 3,
        JSON.stringify(typos),
      );
      check(
        "and it names the rows to go and look at",
        gradeMiss?.rows.join(",") === "2,3,4" && gradeMiss?.value === "AR1z",
        JSON.stringify(gradeMiss),
      );
      check(
        "the designation is reported under its own column",
        typos.find((u) => u.column === "Designation")?.value === "Chief Wizard",
      );

      // A withdrawn grade is worse than an unknown one: it would quietly match
      // and import somebody into a grade FCSL has retired.
      const retired = await prisma.grade.findFirst({ where: { retiredAt: { not: null } } });
      if (retired) {
        const intoRetired = await unmatchedReferences([refRow(2, { grade: retired.name })]);
        check(
          "a retired grade counts as no match, rather than quietly matching",
          intoRetired.length === 1 && intoRetired[0]!.value === retired.name,
          JSON.stringify(intoRetired),
        );
      }

      const managers = await unmatchedReferences([
        // Reporting to somebody further down the same file is legitimate — the
        // commit resolves those once everybody exists.
        refRow(2, { manager: "A 805 - 20 - 70" }),
        refRow(5, {}),
        // And to somebody imported in an earlier run.
        refRow(6, { manager: "A 777 - 20 - 70" }),
        // This one is nowhere at all.
        refRow(7, { manager: "A 999 - 20 - 70" }),
      ]);
      check(
        "a manager elsewhere in the file, or already on record, is not a miss",
        managers.length === 1,
        JSON.stringify(managers),
      );
      check(
        "but a manager who is nowhere is reported as Reports to",
        managers[0]?.column === "Reports to" && managers[0]?.value === "A 999 - 20 - 70",
        JSON.stringify(managers[0]),
      );

      check(
        "[source] the commit and the check read one set of lookups, so they cannot disagree",
        /retiredAt: null \}/.test(source("lib/import-commit.ts")) &&
          /unmatchedReferences/.test(source("lib/import-commit.ts")),
      );
      check(
        "[source] and the commit is refused while any remain, not merely warned about",
        /if \(unmatched\.length\) \{[\s\S]{0,200}Nothing has been saved/.test(
          source("app/actions/hr-import.ts"),
        ),
      );
    } finally {
      await prisma.branch.deleteMany({ where: { id: refBranch.id } });
      void onRecord;
    }
  }

  // ---------------------------------------------------------------------
  console.log("\n35 · The Super Admin's month, FCSL's own example (2 October 2026)");
  {
    // "100 employee and 10 people got paid leave and 5 got unpaid and in total
    // 9 people had 1 day leave and 3 people had 4 days leave" — the same shape,
    // at a size a test can state exactly. May 2029, so no other section's data
    // can land in the same month.
    const YEAR = 2029;
    const MONTH = 5;
    const DAYS = 31;

    const division = await prisma.division.create({ data: { name: QA_DIVISION } });
    const here = await prisma.branch.create({
      data: { name: "QA Month Branch", code: "QAMON", divisionId: division.id },
    });
    const alsoHere = await prisma.branch.create({
      data: { name: "QA Quiet Branch", code: "QAQUI", divisionId: division.id },
    });
    const sickType = (await prisma.leaveType.findFirstOrThrow({ where: { code: "SICK" } }));

    try {
      const take = async (
        email: string,
        name: string,
        from: Date,
        to: Date,
        paid: boolean,
      ) => {
        const person = await fixture(email, name, {
          joiningDate: calendarDate(2020, 1, 1),
          branchId: here.id,
        });
        const planned = planLeaveDays(from, to, new Set());
        await prisma.leaveRequest.create({
          data: {
            employeeId: person.employeeId,
            leaveTypeId: sickType.id,
            reason: "qa month",
            status: "GRANTED",
            paid,
            currentStep: 0,
            days: {
              create: planned.map((day) => ({
                employeeId: person.employeeId,
                leaveTypeId: sickType.id,
                date: day.date,
                dayKind: day.dayKind,
                lengthDays: day.lengthDays,
              })),
            },
          },
        });
        return person;
      };

      // Two working days paid, four working days unpaid. 7–8 May 2029 is a
      // Monday and Tuesday; 14–17 May is Monday to Thursday.
      const paidOne = await take(
        "qa-month-paid@qa.fcsl.invalid",
        "QA Month Paid",
        calendarDate(YEAR, MONTH, 7),
        calendarDate(YEAR, MONTH, 8),
        true,
      );
      await take(
        "qa-month-unpaid@qa.fcsl.invalid",
        "QA Month Unpaid",
        calendarDate(YEAR, MONTH, 14),
        calendarDate(YEAR, MONTH, 17),
        false,
      );

      const byBranch = await monthlySummary(YEAR, MONTH, { kind: "branch", id: here.id });
      check(
        "the month knows its own length, not a flat thirty",
        byBranch.month.days === DAYS && byBranch.personDays === 2 * DAYS,
        `${byBranch.month.days} days, ${byBranch.personDays} person-days`,
      );
      check(
        "how many took leave, and how many took none",
        byBranch.headcount === 2 && byBranch.tookLeave === 2 && byBranch.tookNone === 0,
        `${byBranch.headcount}/${byBranch.tookLeave}/${byBranch.tookNone}`,
      );
      check(
        "paid and unpaid are counted apart, in people and in days",
        byBranch.paid.people === 1 &&
          byBranch.paid.days === 2 &&
          byBranch.unpaid.people === 1 &&
          byBranch.unpaid.days === 4,
        JSON.stringify({ paid: byBranch.paid, unpaid: byBranch.unpaid }),
      );
      check(
        "the ratio is leave days against person-days — 6 of 62",
        byBranch.leaveDays === 6 && byBranch.leaveRatio === 9.7,
        `${byBranch.leaveDays} days, ${byBranch.leaveRatio}%`,
      );
      check(
        "and the distribution reads as FCSL described it: one on 2 days, one on 4",
        JSON.stringify(byBranch.distribution) ===
          JSON.stringify([
            { days: 2, people: 1 },
            { days: 4, people: 1 },
          ]),
        JSON.stringify(byBranch.distribution),
      );
      check(
        "every person who took leave is listed, most first",
        byBranch.people.length === 2 && byBranch.people[0]!.days === 4,
        JSON.stringify(byBranch.people.map((p) => `${p.name}:${p.days}`)),
      );

      // The division holds both branches, so it reports the same people — a
      // person's division follows from their branch.
      const byDivision = await monthlySummary(YEAR, MONTH, { kind: "division", id: division.id });
      check(
        "read by division it finds the same people through their branch",
        byDivision.headcount === 2 && byDivision.leaveDays === 6,
        `${byDivision.headcount} people, ${byDivision.leaveDays} days`,
      );

      const byPerson = await monthlySummary(YEAR, MONTH, { kind: "employee", id: paidOne.employeeId });
      check(
        "and one person at a time is just them",
        byPerson.headcount === 1 && byPerson.leaveDays === 2 && byPerson.unpaid.days === 0,
        `${byPerson.headcount} person, ${byPerson.leaveDays} days`,
      );

      // Nothing published yet, so the figures are provisional and both branches
      // are named as outstanding.
      check(
        "with no branch published, the month is open and says which are missing",
        byDivision.closed === false && byDivision.awaiting.length === 2,
        JSON.stringify(byDivision.awaiting),
      );

      const sheet = await prisma.attendanceSheet.create({
        data: {
          branchId: here.id,
          year: YEAR,
          month: MONTH,
          status: "PUBLISHED",
          publishedByName: "QA",
          publishedAt: new Date(),
          entries: {
            create: [
              {
                employeeId: paidOne.employeeId,
                date: calendarDate(YEAR, MONTH, 21),
                mark: "ABSENT",
              },
            ],
          },
        },
      });
      const published = await monthlySummary(YEAR, MONTH, { kind: "branch", id: here.id });
      check(
        "once its branch publishes, that branch's month is closed",
        published.closed === true && published.awaiting.length === 0,
      );
      check(
        "and the absence is counted, with its own ratio",
        published.absence.days === 1 &&
          published.absence.people === 1 &&
          published.absence.ratio === 1.6,
        JSON.stringify(published.absence),
      );
      check(
        "but the division is still open while the other branch has not published",
        (await monthlySummary(YEAR, MONTH, { kind: "division", id: division.id })).awaiting.join() ===
          "QA Quiet Branch",
      );

      check(
        "[source] the summary is the Super Admin's alone",
        /"reports\.monthlySummary"/.test(source("lib/permissions.ts")) &&
          /requireCapability\("reports\.monthlySummary"\)/.test(source("app/admin/month/page.tsx")),
      );
      void alsoHere;
    } finally {
      await cleanFixtures();
      await prisma.attendanceSheet.deleteMany({ where: { branchId: { in: [here.id, alsoHere.id] } } });
      await prisma.branch.deleteMany({ where: { id: { in: [here.id, alsoHere.id] } } });
      await prisma.division.deleteMany({ where: { id: division.id } });
    }
  }

  // ---------------------------------------------------------------------
  console.log("\n32 · No table is left open to the Data API (16 September 2026)");
  {
    // Supabase hands every table `postgres` creates to the `anon` role, so a
    // migration that adds a model publishes it unless the default privilege is
    // still revoked. The revoke is invisible — nothing fails, the table is
    // simply readable from the internet — so it is checked here rather than
    // remembered.
    //
    // Locally there is no `anon` role and no PostgREST, so what is checkable on
    // this database is the second layer: RLS on, every table, no exceptions.
    const open = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
      ORDER BY c.relname
    `;
    check(
      "every table in public has row level security enabled",
      open.length === 0,
      open.length ? `open: ${open.map((r) => r.relname).join(", ")}` : "",
    );

    const migration = source("prisma/migrations/20260916071500_close_the_data_api/migration.sql");
    check(
      "[source] and the default privilege is revoked, so the next new table is not published",
      /ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated/.test(
        migration,
      ),
    );
    check(
      "[source] RLS is ENABLEd and not FORCEd — the owner is the application",
      /ENABLE ROW LEVEL SECURITY/.test(migration) && !/FORCE ROW LEVEL SECURITY/.test(migration),
    );
  }

  if (sequenceBefore) {
    await prisma.employeeIdSequence.update({
      where: { id: 1 },
      data: { letter: sequenceBefore.letter, nextNumber: sequenceBefore.nextNumber },
    });
  } else {
    // There was no counter before this run; the import created one. Putting it
    // back means removing it, not setting it to a plausible-looking A/1.
    await prisma.employeeIdSequence.deleteMany({ where: { id: 1 } });
  }
  const sequenceAfter = await prisma.employeeIdSequence.findUnique({ where: { id: 1 } });
  check(
    "the employee-ID counter is exactly where the run found it",
    sequenceBefore
      ? sequenceAfter?.letter === sequenceBefore.letter &&
          sequenceAfter?.nextNumber === sequenceBefore.nextNumber
      : sequenceAfter === null,
  );
}

async function fixture(
  email: string,
  fullName: string,
  employee: Record<string, unknown>,
): Promise<{ userId: string; employeeId: string }> {
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("qa-password-not-real", 4),
      role: "EMPLOYEE",
      mustChangePassword: false,
      sessions: {
        create: {
          expiresAt: addDays(todayInDhaka(), 7),
          userAgent: "qa",
          ip: "127.0.0.1",
        },
      },
    },
  });
  const created = await prisma.employee.create({
    data: {
      userId: user.id,
      fullName,
      onboardingStatus: "APPROVED",
      joiningDate: calendarDate(2020, 1, 1),
      ...employee,
    } as never,
  });
  return { userId: user.id, employeeId: created.id };
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanFixtures();
    if (regressionLeaveTypeId) {
      await prisma.leaveType.deleteMany({ where: { id: regressionLeaveTypeId } });
    }
    if (carryLeaveTypeId) {
      await prisma.leaveType.deleteMany({ where: { id: carryLeaveTypeId } });
    }
    // After cleanFixtures: the employees cascade their requisitions away first,
    // so nothing is left pointing here.
    if (requisitionDepartmentId) {
      await prisma.department.deleteMany({ where: { id: requisitionDepartmentId } });
    }
    console.log(`\n${passed} passed, ${failed} failed  (${toISODate(todayInDhaka())})\n`);
    if (failed) process.exitCode = 1;
    await finish();
  });
