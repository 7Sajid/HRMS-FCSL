import type { Prisma, Role } from "@prisma/client";

/**
 * Who may do what.
 *
 * This file is the whole of the answer. Nothing anywhere else in the codebase
 * compares a role string: `user.role === "HR_HEAD"` written inline is a bug
 * even when it produces the right answer, because it is a rule hidden in a
 * place nobody will think to check when the rules change.
 *
 * The grants below are transcribed cell by cell from §9 of the specification,
 * which is the privacy policy of the system and the part employees will ask
 * about. If this table and §9 ever disagree, this table is wrong.
 *
 * There are no imports here except Prisma's types, deliberately: this module
 * has to be callable from a script and from a test with no database, no React
 * and no request behind it.
 */

export type Capability =
  // --- Records
  /** See every employee in every branch. §9 row 4. */
  | "employees.readAll"
  /** See the records of one's own team. §9 row 2. */
  | "team.readRecords"
  /** Open somebody else's documents. §9 row 3 — note the Manager column is a dash. */
  | "documents.readAny"
  /** Bank details of others. §9 row 5. */
  | "bankDetails.read"
  /** Issue the employee ID, set branch, category, grade and manager. §5.3. */
  | "employees.setup"
  /** Check and approve uploaded documents. §9 row 10. */
  | "documents.approve"
  /** Create an employee account. §9 row 10. */
  | "accounts.create"
  /** Create and deactivate accounts of ANY kind, including the HR Head. §5.5. */
  | "accounts.manage"
  // --- Leave
  /** Act as a step in somebody's leave chain. §9 row 6. */
  | "leave.approve"
  /** The last step, which is the only moment leave is actually granted. §9 row 7. */
  | "leave.approveFinal"
  // --- Requisition
  | "requisitions.raise"
  | "requisitions.approve"
  // --- Attendance
  /** Submit the monthly branch sheet. §9 row 11 — managers only. */
  | "attendance.submit"
  /** Verify, correct and publish it. §9 row 12 — HR only. */
  | "attendance.verify"
  // --- Registers
  | "certificates.manage"
  | "terminals.manage"
  | "exits.record"
  | "branches.manage"
  // --- Compliance
  | "showcause.issue"
  | "showcause.readAny"
  // --- Oversight
  | "reports.read"
  | "audit.read"
  /** Leave types, holiday calendar, org lists, thresholds. §12.2. */
  | "settings.manage";

export type Viewer = { id: string; role: Role };

/**
 * Deny by default: a capability nobody is granted is a capability nobody has,
 * and a role's list is exhaustive. Adding a capability to the union above
 * without adding it here means nobody can do it, which is the safe direction
 * for the mistake to fall.
 */
const GRANTS: Record<Role, readonly Capability[]> = {
  EMPLOYEE: [
    // Nothing. An employee sees themselves. Every one of their own pages is
    // reached by self-access, not by a capability, so there is no entry here
    // that could be widened by accident.
  ],

  MANAGER: [
    "team.readRecords",
    "leave.approve",
    "requisitions.raise",
    "attendance.submit",
    // Deliberately absent: documents.readAny and bankDetails.read. A manager
    // sees that their team member is on leave, not their NID. A manager needs
    // to plan work, not hold somebody's identity documents (§9).
  ],

  HR_EXECUTIVE: [
    "employees.readAll",
    "team.readRecords",
    "documents.readAny",
    "bankDetails.read",
    "employees.setup",
    "documents.approve",
    "accounts.create",
    "requisitions.raise",
    "attendance.verify",
    "certificates.manage",
    "exits.record",
    // Deliberately absent, from §5.3's own CANNOT list: approve leave, approve
    // requisitions, issue show-cause letters, create or close branches, manage
    // trading terminals, see company-wide reports.
    //
    // The division is the point: the HR Executive handles RECORDS, the HR Head
    // handles DECISIONS. One person entering the data and a different person
    // approving it is a basic control, and the sort of separation a regulator
    // expects to see.
  ],

  HR_HEAD: [
    "employees.readAll",
    "team.readRecords",
    "documents.readAny",
    "bankDetails.read",
    "employees.setup",
    "documents.approve",
    "accounts.create",
    "leave.approve",
    "requisitions.raise",
    "requisitions.approve",
    "attendance.verify",
    "certificates.manage",
    "terminals.manage",
    "exits.record",
    "branches.manage",
    "showcause.issue",
    "showcause.readAny",
    "reports.read",
    "audit.read",
    "settings.manage",
  ],

  SUPER_ADMIN: [
    "employees.readAll",
    "team.readRecords",
    "documents.readAny",
    "employees.setup",
    "documents.approve",
    "accounts.create",
    "accounts.manage",
    "leave.approve",
    "leave.approveFinal",
    "requisitions.raise",
    "requisitions.approve",
    "certificates.manage",
    "terminals.manage",
    "exits.record",
    "branches.manage",
    "showcause.issue",
    "showcause.readAny",
    "reports.read",
    "audit.read",

    // TWO ABSENCES THAT LOOK LIKE MISTAKES AND ARE NOT. Both are read straight
    // off §9, and both are the rows most likely to be "fixed" by somebody who
    // assumes the top role sees everything:
    //
    //   bankDetails.read  — "The Super Admin cannot see bank details. That is
    //     deliberate. The Super Admin approves and oversees; the people who
    //     need account numbers to do their job are in HR."
    //
    //   attendance.verify — verifying and publishing the monthly sheet is HR's
    //     work. §9 row 12 gives it to the HR Executive and HR Head only.
    //
    // settings.manage is also absent: §12.2 puts leave types and the holiday
    // calendar in the HR Head's hands. If an HR Head leaves, the Super Admin
    // appoints another rather than reaching past them.
  ],
};

export function can(viewer: Viewer | null | undefined, capability: Capability): boolean {
  if (!viewer) return false;
  return GRANTS[viewer.role]?.includes(capability) ?? false;
}

/** True if the role holds any of these. Use for "should this menu exist". */
export function canAny(viewer: Viewer | null | undefined, capabilities: readonly Capability[]): boolean {
  return capabilities.some((c) => can(viewer, c));
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  HR_HEAD: "HR Head",
  HR_EXECUTIVE: "HR Executive",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
};

/**
 * Everybody with a role may sign in — unlike the sister project, there is no
 * role here that exists only as a data label. What a person sees afterwards is
 * decided by the locked door and by the grants above, not at the door.
 */
export function canSignIn(viewer: Viewer): boolean {
  return viewer.role in GRANTS;
}

/** Where a person lands after signing in. */
export function homePathFor(viewer: Viewer): string {
  if (can(viewer, "accounts.manage")) return "/admin/approvals";
  if (can(viewer, "documents.approve")) return "/hr/joiners";
  if (can(viewer, "leave.approve")) return "/team/approvals";
  return "/me/profile";
}

// ---------------------------------------------------------------------------
// Scoped access
//
// Scope is asked IN THE QUERY, never compared after the read. A filter applied
// after the rows have already been fetched is a filter somebody will forget,
// and the row was in memory either way.
// ---------------------------------------------------------------------------

/**
 * Which employees this viewer may see at all.
 *
 * The team case leans on EmployeeAssignment rather than Employee.managerId, so
 * that §5.2 holds: "the old manager keeps access to the records of the period
 * when that person reported to them, and loses access to everything after the
 * transfer date." A manager who read a file last year can still read that
 * period this year; they cannot read what happened after the transfer.
 */
export function visibleEmployeeWhere(
  viewer: Viewer,
  selfEmployeeId: string | null,
): Prisma.EmployeeWhereInput {
  if (can(viewer, "employees.readAll")) return {};

  // A literal that cannot be a cuid, so a viewer with no employee record of
  // their own matches nothing rather than matching everything.
  const self = selfEmployeeId ?? "__no_employee_record__";

  if (can(viewer, "team.readRecords")) {
    return {
      OR: [
        { id: self },
        { managerId: self },
        { assignments: { some: { managerId: self } } },
      ],
    };
  }

  return { id: self };
}

/**
 * May this viewer open somebody's documents?
 *
 * Their own, always. Everyone else's needs `documents.readAny` — which a
 * manager does not have, and that is the interesting cell in §9 row 3.
 */
export function canReadDocumentsOf(viewer: Viewer, ownerEmployeeId: string, selfEmployeeId: string | null): boolean {
  if (selfEmployeeId && ownerEmployeeId === selfEmployeeId) return true;
  return can(viewer, "documents.readAny");
}

/** §9 row 5. Their own, always; anybody else's needs the capability. */
export function canReadBankDetailsOf(viewer: Viewer, ownerEmployeeId: string, selfEmployeeId: string | null): boolean {
  if (selfEmployeeId && ownerEmployeeId === selfEmployeeId) return true;
  return can(viewer, "bankDetails.read");
}

/**
 * A show-cause is visible to the HR Head, the employee concerned, and nobody
 * else by default — not even their manager, unless the HR Head chooses to
 * include them (§6.5).
 */
export function canReadShowCause(
  viewer: Viewer,
  showCause: { employeeId: string; visibleToManager: boolean },
  selfEmployeeId: string | null,
  isTheirManager: boolean,
): boolean {
  if (selfEmployeeId && showCause.employeeId === selfEmployeeId) return true;
  if (can(viewer, "showcause.readAny")) return true;
  return showCause.visibleToManager && isTheirManager;
}

/**
 * Private notes. There is no viewer argument because there is no answer that
 * depends on one: a note is readable by the account that wrote it and by
 * nothing else, the Super Admin included.
 *
 * This exists as a named function so that the rule is greppable, and so that
 * anybody who tries to add an exception has to edit something that says in
 * plain words why they should not.
 */
export function canReadNote(note: { userId: string }, viewerUserId: string): boolean {
  return note.userId === viewerUserId;
}
