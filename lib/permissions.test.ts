import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  can,
  canReadBankDetailsOf,
  canReadDocumentsOf,
  canReadNote,
  canReadShowCause,
  homePathFor,
  visibleEmployeeWhere,
  type Capability,
  type Viewer,
} from "./permissions";

/**
 * §9 of the specification, transcribed as a table and asserted cell by cell.
 *
 * The point of writing it this way rather than as prose assertions is that the
 * test reads like the document it is checking. Somebody comparing the two can
 * put them side by side, and a row that has been quietly widened shows up as a
 * changed character rather than as a missing test.
 *
 * Columns are in the document's order: Employee/RM · Manager · HR Executive ·
 * HR Head · Super Admin.
 */

const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"];

/** "—✓✓✓✓" reads as the document prints it. */
type Row = { spec: string; capability: Capability; grid: string };

const SECTION_9: Row[] = [
  { spec: "Their own team's records", capability: "team.readRecords", grid: "—✓✓✓✓" },
  { spec: "Their own team's documents", capability: "documents.readAny", grid: "——✓✓✓" },
  { spec: "Every employee in every branch", capability: "employees.readAll", grid: "——✓✓✓" },
  { spec: "Bank details of others", capability: "bankDetails.read", grid: "——✓✓—" },
  { spec: "Approve leave — first step for their team", capability: "leave.approve", grid: "—✓—✓✓" },
  { spec: "Final approval of leave", capability: "leave.approveFinal", grid: "————✓" },
  { spec: "Raise a requisition", capability: "requisitions.raise", grid: "—✓✓✓✓" },
  { spec: "Approve requisitions", capability: "requisitions.approve", grid: "———✓✓" },
  { spec: "Approve documents, create accounts", capability: "documents.approve", grid: "——✓✓✓" },
  { spec: "Approve documents, create accounts", capability: "accounts.create", grid: "——✓✓✓" },
  { spec: "Submit branch attendance", capability: "attendance.submit", grid: "—✓———" },
  { spec: "Verify and publish attendance", capability: "attendance.verify", grid: "——✓✓—" },
  { spec: "The RM certificate register", capability: "certificates.manage", grid: "——✓✓✓" },
  { spec: "The trading terminal register", capability: "terminals.manage", grid: "———✓✓" },
  { spec: "Record a leaver", capability: "exits.record", grid: "——✓✓✓" },
  { spec: "Issue a show-cause letter", capability: "showcause.issue", grid: "———✓✓" },
  { spec: "Read somebody else's show-cause file", capability: "showcause.readAny", grid: "———✓✓" },
  { spec: "Create and close branches", capability: "branches.manage", grid: "———✓✓" },
  { spec: "Company-wide reports", capability: "reports.read", grid: "———✓✓" },
  { spec: "The permanent record of all actions", capability: "audit.read", grid: "———✓✓" },
];

const viewer = (role: Role): Viewer => ({ id: `viewer-${role}`, role });

describe("§9 — who can see whose information", () => {
  for (const row of SECTION_9) {
    const cells = [...row.grid];
    it(`${row.spec} (${row.capability}) — ${row.grid}`, () => {
      expect(cells).toHaveLength(ROLES.length);
      ROLES.forEach((role, i) => {
        const expected = cells[i] === "✓";
        expect(
          can(viewer(role), row.capability),
          `${role} should ${expected ? "have" : "NOT have"} ${row.capability}`,
        ).toBe(expected);
      });
    });
  }
});

describe("the two rows most likely to be 'fixed' by mistake", () => {
  // Both of these are read straight off §9 and both look wrong to somebody who
  // assumes the top role sees everything. They are not wrong.

  it("the Super Admin cannot read bank details", () => {
    expect(can(viewer("SUPER_ADMIN"), "bankDetails.read")).toBe(false);
    // ...and the people who need account numbers to do their job can.
    expect(can(viewer("HR_EXECUTIVE"), "bankDetails.read")).toBe(true);
    expect(can(viewer("HR_HEAD"), "bankDetails.read")).toBe(true);
  });

  it("the Super Admin does not verify or publish attendance", () => {
    expect(can(viewer("SUPER_ADMIN"), "attendance.verify")).toBe(false);
    expect(can(viewer("HR_EXECUTIVE"), "attendance.verify")).toBe(true);
  });

  it("only a manager submits the branch attendance sheet", () => {
    expect(can(viewer("MANAGER"), "attendance.submit")).toBe(true);
    for (const role of ROLES.filter((r) => r !== "MANAGER")) {
      expect(can(viewer(role), "attendance.submit")).toBe(false);
    }
  });
});

describe("§5.3 — what an HR Executive CANNOT do", () => {
  // The division is deliberate: the HR Executive handles records, the HR Head
  // handles decisions. One person entering the data and a different person
  // approving it is the control a regulator expects to see.
  const forbidden: Capability[] = [
    "leave.approve",
    "requisitions.approve",
    "showcause.issue",
    "branches.manage",
    "terminals.manage",
    "reports.read",
  ];

  for (const capability of forbidden) {
    it(`an HR Executive cannot ${capability}`, () => {
      expect(can(viewer("HR_EXECUTIVE"), capability)).toBe(false);
    });
  }
});

describe("an ordinary employee holds no capability at all", () => {
  it("every capability in §9 is denied", () => {
    for (const row of SECTION_9) {
      expect(can(viewer("EMPLOYEE"), row.capability)).toBe(false);
    }
  });

  it("and neither does an RM — an RM is an employee with one extra document", () => {
    // There is no RM role by design (§2). If one is ever added, this fails.
    expect(ROLES).not.toContain("RM" as Role);
  });
});

describe("deny by default", () => {
  it("refuses an unknown viewer", () => {
    expect(can(null, "employees.readAll")).toBe(false);
    expect(can(undefined, "audit.read")).toBe(false);
  });

  it("refuses a role that is not in the grant table", () => {
    expect(can({ id: "x", role: "AUDITOR" as Role }, "employees.readAll")).toBe(false);
  });
});

describe("private notes", () => {
  it("are readable by their author and by nobody else, the Super Admin included", () => {
    const note = { userId: "user-karim" };
    expect(canReadNote(note, "user-karim")).toBe(true);
    expect(canReadNote(note, "user-the-super-admin")).toBe(false);
    expect(canReadNote(note, "user-hr-head")).toBe(false);
  });
});

describe("visibleEmployeeWhere — scope asked in the query", () => {
  it("gives HR the whole company", () => {
    expect(visibleEmployeeWhere(viewer("HR_EXECUTIVE"), "emp-hr")).toEqual({});
    expect(visibleEmployeeWhere(viewer("SUPER_ADMIN"), null)).toEqual({});
  });

  it("gives a manager themselves, their reports, and anyone who ever reported to them", () => {
    const where = visibleEmployeeWhere(viewer("MANAGER"), "emp-manager");
    expect(where).toEqual({
      OR: [
        { id: "emp-manager" },
        { managerId: "emp-manager" },
        // The historical arm. §5.2: the old manager keeps access to the period
        // when that person reported to them, and loses everything after.
        { assignments: { some: { managerId: "emp-manager" } } },
      ],
    });
  });

  it("gives an employee only themselves", () => {
    expect(visibleEmployeeWhere(viewer("EMPLOYEE"), "emp-karim")).toEqual({ id: "emp-karim" });
  });

  it("matches nothing — not everything — when the viewer has no employee record", () => {
    // The first Super Admin is created at installation with no employee record
    // behind it. A naive `{ id: undefined }` here would be an empty filter,
    // which Prisma reads as "every row".
    const where = visibleEmployeeWhere(viewer("EMPLOYEE"), null);
    expect(where).toEqual({ id: "__no_employee_record__" });
    expect(Object.values(where)).not.toContain(undefined);
  });
});

describe("self-access does not need a capability", () => {
  it("an employee reads their own documents and bank details", () => {
    const me = viewer("EMPLOYEE");
    expect(canReadDocumentsOf(me, "emp-karim", "emp-karim")).toBe(true);
    expect(canReadBankDetailsOf(me, "emp-karim", "emp-karim")).toBe(true);
  });

  it("but not anybody else's", () => {
    const me = viewer("EMPLOYEE");
    expect(canReadDocumentsOf(me, "emp-salma", "emp-karim")).toBe(false);
    expect(canReadBankDetailsOf(me, "emp-salma", "emp-karim")).toBe(false);
  });

  it("and a manager reads their team's records but not their team's documents", () => {
    const boss = viewer("MANAGER");
    expect(can(boss, "team.readRecords")).toBe(true);
    expect(canReadDocumentsOf(boss, "emp-karim", "emp-manager")).toBe(false);
    expect(canReadBankDetailsOf(boss, "emp-karim", "emp-manager")).toBe(false);
  });
});

describe("show-cause visibility (§6.5)", () => {
  const record = { employeeId: "emp-karim", visibleToManager: false };

  it("is visible to the employee concerned", () => {
    expect(canReadShowCause(viewer("EMPLOYEE"), record, "emp-karim", false)).toBe(true);
  });

  it("is visible to the HR Head and the Super Admin", () => {
    expect(canReadShowCause(viewer("HR_HEAD"), record, null, false)).toBe(true);
    expect(canReadShowCause(viewer("SUPER_ADMIN"), record, null, false)).toBe(true);
  });

  it("is NOT visible to the HR Executive, who issues no disciplinary letters", () => {
    expect(canReadShowCause(viewer("HR_EXECUTIVE"), record, "emp-hr", false)).toBe(false);
  });

  it("is NOT visible to their own manager by default", () => {
    expect(canReadShowCause(viewer("MANAGER"), record, "emp-manager", true)).toBe(false);
  });

  it("becomes visible to their manager only when the HR Head chooses to include them", () => {
    const shared = { employeeId: "emp-karim", visibleToManager: true };
    expect(canReadShowCause(viewer("MANAGER"), shared, "emp-manager", true)).toBe(true);
    // ...and still not to a manager it is not shared with.
    expect(canReadShowCause(viewer("MANAGER"), shared, "emp-other-boss", false)).toBe(false);
  });
});

describe("where each panel lands after signing in", () => {
  it("sends each role to its own panel", () => {
    expect(homePathFor(viewer("SUPER_ADMIN"))).toBe("/admin/approvals");
    expect(homePathFor(viewer("HR_HEAD"))).toBe("/hr/joiners");
    expect(homePathFor(viewer("HR_EXECUTIVE"))).toBe("/hr/joiners");
    expect(homePathFor(viewer("MANAGER"))).toBe("/team/approvals");
    expect(homePathFor(viewer("EMPLOYEE"))).toBe("/me/profile");
  });
});
