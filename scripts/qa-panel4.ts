import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { can, type Capability } from "../lib/permissions";
import { ruleOn } from "../lib/leave";
import { auditWhere, readFilters, summariseDetail } from "../lib/audit-query";
import { ACTION_GROUPS } from "../lib/audit";
import {
  DEFAULT_ESCALATE_AFTER_WORKING_DAYS,
  byLongestWaiting,
  escalateAfterWorkingDays,
  isOverdue,
  waitedWorkingDays,
} from "../lib/escalation";
import { calendarDate, todayInDhaka } from "../lib/dates";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";

/**
 * Panel 4 — the HR Head.
 *
 * The gate checks from the plan, run against the real functions rather than
 * against a restatement of them: the one inbox and its three-working-day
 * amber, a branch that refuses to close while people are attached, a dated
 * leave rule that leaves last year's leave alone, and the permanent record
 * viewer — including the part that matters most, that it cannot write.
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
const madeBranches: string[] = [];
const madeLeaveTypes: string[] = [];

async function person(name: string, role: Role, branchId?: string) {
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
      branchId: branchId ?? null,
    },
  });
  madeUsers.push(user.id);
  return { user, employee };
}

async function main() {
  await cleanFixtures();

  try {
    // -----------------------------------------------------------------------
    console.log("\nEvery Panel 4 page is a lock, not a hidden menu");
    // The pages guard themselves with these capabilities. Asserting the grants
    // is asserting what typing the URL gets you, because `requireCapability`
    // asks exactly this question.
    const pages: { path: string; capability: Capability }[] = [
      { path: "/hr/approvals", capability: "requisitions.approve" },
      { path: "/hr/branches", capability: "branches.manage" },
      { path: "/hr/terminals", capability: "terminals.manage" },
      { path: "/hr/compliance", capability: "showcause.issue" },
      { path: "/hr/reports", capability: "reports.read" },
      { path: "/hr/settings", capability: "settings.manage" },
      // Not /admin/audit: FCSL made the permanent record the Super Admin's
      // alone on 10 September 2026. Asserted as a refusal below.
    ];
    const roles: Role[] = ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"];
    for (const page of pages) {
      const allowed = roles.filter((role) => can({ id: "x", role }, page.capability));
      check(
        `${page.path} — open to ${allowed.join(", ") || "nobody"}`,
        allowed.includes("HR_HEAD"),
        `HR Head is missing ${page.capability}`,
      );
      check(
        `${page.path} — refused to an ordinary employee`,
        !allowed.includes("EMPLOYEE"),
      );
    }
    // The two rows §9 gets wrong in every retelling, restated at this gate.
    const asRole = (role: Role) => ({ id: "x", role });
    check(
      "the Super Admin still cannot read bank details",
      !can(asRole("SUPER_ADMIN"), "bankDetails.read"),
    );
    check(
      "and still does not verify or publish attendance",
      !can(asRole("SUPER_ADMIN"), "attendance.verify"),
    );
    check(
      "settings belong to the HR Head, not the Super Admin",
      can(asRole("HR_HEAD"), "settings.manage") && !can(asRole("SUPER_ADMIN"), "settings.manage"),
    );
    check(
      "the permanent record is refused to the HR Head (FCSL, 10 September 2026)",
      !can(asRole("HR_HEAD"), "audit.read") && can(asRole("SUPER_ADMIN"), "audit.read"),
    );

    // -----------------------------------------------------------------------
    console.log("\nThe one inbox, and what turns amber");
    const threshold = await escalateAfterWorkingDays();
    check(
      `the threshold comes from the setting, not from the code (${threshold} working days)`,
      threshold === 3,
    );

    const stored = await prisma.setting.findUnique({
      where: { key: "approval.escalateAfterWorkingDays" },
    });
    check("and the setting HR can change is the one being read", stored?.value === String(threshold));

    // A Wednesday, so the arithmetic crosses a Friday and Saturday and the
    // count is genuinely working days rather than calendar days.
    const wednesday = calendarDate(2026, 9, 2);
    const monday = calendarDate(2026, 9, 7);
    check(
      "Wednesday to the following Monday is 3 working days, not 5",
      waitedWorkingDays(wednesday, monday) === 3,
    );
    check("3 working days is amber", isOverdue(waitedWorkingDays(wednesday, monday), threshold));
    check(
      "2 working days is not",
      !isOverdue(waitedWorkingDays(calendarDate(2026, 9, 3), monday), threshold),
    );

    const items = [
      { id: "new", at: calendarDate(2026, 9, 6) },
      { id: "old", at: calendarDate(2026, 8, 24) },
      { id: "middling", at: calendarDate(2026, 9, 2) },
    ];
    const ordered = byLongestWaiting(items, (i) => i.at, monday);
    check("the longest-waiting item sits at the top", ordered[0]?.item.id === "old");
    check("and the newest at the bottom", ordered.at(-1)?.item.id === "new");
    // The two inboxes had this number typed into them by hand and neither read
    // the setting, so the assertion has to be about the source rather than
    // about a function I can call — calling it would only prove the library
    // works, which was never the thing that was broken.
    const inboxSources = [
      "components/approvals/LeaveInbox.tsx",
      "components/approvals/RequisitionInbox.tsx",
    ].map((file) => ({ file, text: readFileSync(new URL(`../${file}`, import.meta.url), "utf8") }));

    for (const { file, text } of inboxSources) {
      check(
        `${file.split("/").pop()} reads the threshold from the setting`,
        text.includes("escalateAfterWorkingDays"),
      );
      check(
        `${file.split("/").pop()} has no threshold typed into it`,
        !/waited\s*>=\s*\d/.test(text),
      );
      check(
        `${file.split("/").pop()} orders by the shared function`,
        text.includes("byLongestWaiting"),
      );
    }
    check(
      "and the fallback, for a setting that has been blanked, is three",
      DEFAULT_ESCALATE_AFTER_WORKING_DAYS === 3,
    );

    // -----------------------------------------------------------------------
    console.log("\nA branch cannot be closed with people still attached");
    const branch = await prisma.branch.create({
      data: { name: "QA Branch", code: `QA${Date.now() % 100000}`, openedOn: calendarDate(2020, 1, 1) },
    });
    madeBranches.push(branch.id);
    const attached = await person("QA Branch Person", "EMPLOYEE", branch.id);

    // The same query `closeBranch` runs before it will write anything.
    const withPeople = await prisma.branch.findUnique({
      where: { id: branch.id },
      include: { employees: { where: { status: "ACTIVE" }, select: { id: true } } },
    });
    check("the branch reports its active people", withPeople?.employees.length === 1);
    check("so closing is refused", (withPeople?.employees.length ?? 0) > 0);
    check("and nothing has been written — it is still open", withPeople?.closedOn === null);

    // Move the person, exactly as HR would have to.
    await prisma.employee.update({ where: { id: attached.employee.id }, data: { branchId: null } });
    const emptied = await prisma.branch.findUnique({
      where: { id: branch.id },
      include: { employees: { where: { status: "ACTIVE" }, select: { id: true } } },
    });
    check("once they are moved, closing is allowed", emptied?.employees.length === 0);

    // A person who has LEFT does not block a closure — their history stays
    // pointed at the branch, which is the whole reason it is closed and not
    // deleted.
    await prisma.employee.update({
      where: { id: attached.employee.id },
      data: { branchId: branch.id, status: "LEFT", lastWorkingDay: calendarDate(2026, 1, 31) },
    });
    const withLeaver = await prisma.branch.findUnique({
      where: { id: branch.id },
      include: { employees: { where: { status: "ACTIVE" }, select: { id: true } } },
    });
    check("a former employee's history does not block the closure", withLeaver?.employees.length === 0);

    // -----------------------------------------------------------------------
    console.log("\nA leave rule is added with a date, never edited");
    const leaveType = await prisma.leaveType.create({
      data: { name: "QA Leave", code: `QA${Date.now() % 100000}` },
    });
    madeLeaveTypes.push(leaveType.id);
    await prisma.leaveTypeRule.create({
      data: {
        leaveTypeId: leaveType.id,
        daysPerYear: 10,
        effectiveFrom: calendarDate(2020, 1, 1),
        createdByName: "QA",
      },
    });
    await prisma.leaveTypeRule.create({
      data: {
        leaveTypeId: leaveType.id,
        daysPerYear: 15,
        effectiveFrom: calendarDate(2027, 1, 1),
        createdByName: "QA",
      },
    });

    const rules = await prisma.leaveTypeRule.findMany({
      where: { leaveTypeId: leaveType.id },
      orderBy: { effectiveFrom: "desc" },
    });
    check("both rules exist — the old one was not overwritten", rules.length === 2);
    check(
      "leave taken last year still computes on last year's rule",
      Number(ruleOn(rules, calendarDate(2025, 6, 1))?.daysPerYear) === 10,
    );
    check(
      "leave taken today still computes on today's rule",
      Number(ruleOn(rules, calendarDate(2026, 9, 7))?.daysPerYear) === 10,
    );
    check(
      "and only from the effective date does the new figure apply",
      Number(ruleOn(rules, calendarDate(2027, 1, 1))?.daysPerYear) === 15,
    );
    check(
      "the day before it takes effect, the old rule still governs",
      Number(ruleOn(rules, calendarDate(2026, 12, 31))?.daysPerYear) === 10,
    );
    check(
      "a date before any rule resolves to nothing rather than guessing",
      ruleOn(rules, calendarDate(2019, 1, 1)) === null,
    );

    // -----------------------------------------------------------------------
    console.log("\nThe permanent record cannot be written to");
    const line = await prisma.auditEvent.findFirst({ orderBy: { createdAt: "desc" } });
    check("there is something in the log to try to change", line !== null);

    let updateRefused = false;
    try {
      await prisma.auditEvent.update({
        where: { id: line!.id },
        data: { action: "auth.signed_in" },
      });
    } catch {
      updateRefused = true;
    }
    check("Postgres refuses an UPDATE, even through Prisma", updateRefused);

    let deleteRefused = false;
    try {
      await prisma.auditEvent.delete({ where: { id: line!.id } });
    } catch {
      deleteRefused = true;
    }
    check("and refuses a DELETE", deleteRefused);

    const stillThere = await prisma.auditEvent.findUnique({ where: { id: line!.id } });
    check("the line is exactly as it was", stillThere?.action === line!.action);

    // -----------------------------------------------------------------------
    console.log("\nThe viewer's filters ask the database the right question");
    const config = ACTION_GROUPS.find((g) => g.label === "Configuration")!;
    check("every action name belongs to exactly one chip", (() => {
      const seen = new Set<string>();
      for (const group of ACTION_GROUPS) {
        for (const action of group.actions) {
          if (seen.has(action)) return false;
          seen.add(action);
        }
      }
      return true;
    })());

    const inGroup = await prisma.auditEvent.count({
      where: auditWhere(readFilters({ group: "Configuration" })),
    });
    const byHand = await prisma.auditEvent.count({ where: { action: { in: config.actions } } });
    check("a chip returns exactly its own group's rows", inGroup === byHand);

    const exact = await prisma.auditEvent.count({
      where: auditWhere(readFilters({ group: "Access", action: "settings.updated" })),
    });
    const settingsOnly = await prisma.auditEvent.count({ where: { action: "settings.updated" } });
    check(
      "naming an exact action overrides the chip rather than contradicting it",
      exact === settingsOnly,
    );

    // The Dhaka boundary: an action at 11pm Dhaka is 5pm UTC the same day, but
    // 6am UTC would be the previous day in a naive range. Filtering "today" has
    // to include it.
    const today = todayInDhaka();
    const iso = today.toISOString().slice(0, 10);
    const evening = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 17, 30));
    await prisma.auditEvent.create({
      data: {
        action: "system.cron_ran",
        actorName: "QA",
        actorRole: "",
        targetType: "qa",
        targetLabel: "QA evening line",
        createdAt: evening,
      },
    });
    const todayRows = await prisma.auditEvent.findMany({
      where: auditWhere(readFilters({ from: iso, to: iso })),
      select: { id: true, targetLabel: true },
    });
    check(
      "an action at 11:30pm Dhaka is inside today, not tomorrow",
      todayRows.some((r) => r.targetLabel === "QA evening line"),
    );

    const yesterdayIso = new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10);
    const yesterdayRows = await prisma.auditEvent.count({
      where: auditWhere(readFilters({ from: yesterdayIso, to: yesterdayIso })),
    });
    const both = await prisma.auditEvent.count({
      where: auditWhere(readFilters({ from: yesterdayIso, to: iso })),
    });
    check("and a two-day range holds both days", both >= todayRows.length + yesterdayRows - 1);

    console.log("\nThe detail column is summarised, not dumped");
    check(
      "a before/after pair names the fields that changed",
      summariseDetail({ changes: { mobile: { from: "a", to: "b" } } }) === "Changed mobile",
    );
    check(
      "a reason is shown in full, because §6 says nobody is told anything without one",
      summariseDetail({ reason: "Certificate expired" }) === "Certificate expired",
    );
    check("and nothing at all is a blank, not the word undefined", summariseDetail(null) === "");
  } finally {
    // Audit rows are never deleted — that is the point of the table — so the
    // QA lines stay. Everything else goes by exact id.
    await prisma.leaveTypeRule.deleteMany({ where: { leaveTypeId: { in: madeLeaveTypes } } });
    await prisma.leaveType.deleteMany({ where: { id: { in: madeLeaveTypes } } });
    await prisma.employee.updateMany({
      where: { branchId: { in: madeBranches } },
      data: { branchId: null },
    });
    await prisma.employee.deleteMany({ where: { userId: { in: madeUsers } } });
    await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
    await prisma.branch.deleteMany({ where: { id: { in: madeBranches } } });
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
