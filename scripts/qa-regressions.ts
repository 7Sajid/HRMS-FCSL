import { readFileSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { addDays, calendarDate, todayInDhaka, toISODate } from "../lib/dates";
import { runAccessClosure } from "../lib/jobs";
import { ACTION_GROUPS, ACTION_LABELS, actionLabel } from "../lib/audit";
import { employeeRecordScope } from "../lib/permissions";
import { showCauseReplyPdf } from "../lib/pdf";
import { documentKey, getObject, putObject } from "../lib/storage";
import { commitImport } from "../lib/import-commit";
import { consumeEntitlement } from "../lib/leave-service";
import type { CheckedRow } from "../lib/import";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";

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

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

async function main() {
  await cleanFixtures();
  // A run that died before its `finally` leaves this behind, and the code is
  // unique. Cleared by that exact code, never by a predicate that could match
  // a leave type the HR Head entered.
  await prisma.leaveType.deleteMany({ where: { code: "QA_REG" } });

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
  console.log("\n2 · The 412-staff import finishes inside a request (§12.1)");
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
  check("every RM keeps their certificate", certificates === Math.ceil(ROWS / 5), `${certificates}`);

  check(
    "nobody arrives behind the locked door — imported staff are already employed",
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
    /scope\.limited\s*\?\s*\[\]\s*:\s*await leaveTypesFor/.test(rosterSource),
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
    console.log(`\n${passed} passed, ${failed} failed  (${toISODate(todayInDhaka())})\n`);
    if (failed) process.exitCode = 1;
    await finish();
  });
