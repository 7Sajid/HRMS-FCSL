import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  can,
  canReadBankDetailsOf,
  canReadDocumentsOf,
  canReadNote,
  canReadShowCause,
  employeeRecordScope,
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
 * Columns are in the document's order: Executive/Associate · Manager · HR Executive ·
 * HR Head · Super Admin.
 */

const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"];

/** "—✓✓✓✓" reads as the document prints it. */
type Row = { spec: string; capability: Capability; grid: string };

// Rows marked "10 Sep" were amended by FCSL on 10 September 2026: "My team",
// raising a requisition and the first leave step are for managers and the HR
// Head only, and the permanent record is the Super Admin's alone.
const SECTION_9: Row[] = [
  { spec: "Their own team's records (10 Sep)", capability: "team.readRecords", grid: "—✓—✓—" },
  { spec: "Their own team's documents", capability: "documents.readAny", grid: "——✓✓✓" },
  { spec: "Every employee in every branch", capability: "employees.readAll", grid: "——✓✓✓" },
  { spec: "Bank details of others", capability: "bankDetails.read", grid: "——✓✓—" },
  { spec: "Approve leave — first step for their team (10 Sep)", capability: "leave.approve", grid: "—✓—✓—" },
  { spec: "Final approval of leave", capability: "leave.approveFinal", grid: "————✓" },
  { spec: "Raise a requisition (10 Sep)", capability: "requisitions.raise", grid: "—✓—✓—" },
  { spec: "Approve requisitions", capability: "requisitions.approve", grid: "———✓✓" },
  { spec: "Approve documents, create accounts", capability: "documents.approve", grid: "——✓✓✓" },
  { spec: "Approve documents, create accounts", capability: "accounts.create", grid: "——✓✓✓" },
  { spec: "Submit branch attendance", capability: "attendance.submit", grid: "—✓———" },
  { spec: "Verify and publish attendance", capability: "attendance.verify", grid: "——✓✓—" },
  { spec: "The Associate certificate register", capability: "certificates.manage", grid: "——✓✓✓" },
  { spec: "The trading terminal register", capability: "terminals.manage", grid: "———✓✓" },
  { spec: "Record a leaver", capability: "exits.record", grid: "——✓✓✓" },
  { spec: "Issue a show-cause letter", capability: "showcause.issue", grid: "———✓✓" },
  { spec: "Read somebody else's show-cause file", capability: "showcause.readAny", grid: "———✓✓" },
  { spec: "Create and close branches", capability: "branches.manage", grid: "———✓✓" },
  { spec: "Company-wide reports", capability: "reports.read", grid: "———✓✓" },
  { spec: "The permanent record of all actions (10 Sep)", capability: "audit.read", grid: "————✓" },
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
    // Added when FCSL amended §9 on 10 September 2026.
    "team.readRecords",
    "requisitions.raise",
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

  it("and neither does an Associate — an Associate is an employee with one extra document", () => {
    // There is no Associate role by design (§2). If one is ever added, this fails.
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
    expect(canReadDocumentsOf(me, "emp-karim", "emp-karim", "NID")).toBe(true);
    expect(canReadBankDetailsOf(me, "emp-karim", "emp-karim")).toBe(true);
  });

  it("but not anybody else's", () => {
    const me = viewer("EMPLOYEE");
    expect(canReadDocumentsOf(me, "emp-salma", "emp-karim", "NID")).toBe(false);
    expect(canReadBankDetailsOf(me, "emp-salma", "emp-karim")).toBe(false);
  });

  it("and a manager reads their team's records but not their team's documents", () => {
    const boss = viewer("MANAGER");
    expect(can(boss, "team.readRecords")).toBe(true);
    expect(canReadDocumentsOf(boss, "emp-karim", "emp-manager", "NID")).toBe(false);
    expect(canReadBankDetailsOf(boss, "emp-karim", "emp-manager")).toBe(false);
  });
});

describe("a show-cause document is narrower than a document (§6.5)", () => {
  // Three roles hold documents.readAny; only two hold showcause.readAny. The
  // reply PDF is filed as a document, so the gap is real and this is where it
  // is closed.
  it("an HR Executive reads an NID and does NOT read a show-cause reply", () => {
    const exec = viewer("HR_EXECUTIVE");
    expect(canReadDocumentsOf(exec, "emp-karim", "emp-hr", "NID")).toBe(true);
    expect(canReadDocumentsOf(exec, "emp-karim", "emp-hr", "SHOWCAUSE_REPLY")).toBe(false);
    expect(canReadDocumentsOf(exec, "emp-karim", "emp-hr", "SHOWCAUSE_LETTER")).toBe(false);
  });

  it("the HR Head reads both", () => {
    const head = viewer("HR_HEAD");
    expect(canReadDocumentsOf(head, "emp-karim", "emp-head", "NID")).toBe(true);
    expect(canReadDocumentsOf(head, "emp-karim", "emp-head", "SHOWCAUSE_REPLY")).toBe(true);
  });

  it("and the person it is about reads their own", () => {
    const me = viewer("EMPLOYEE");
    expect(canReadDocumentsOf(me, "emp-karim", "emp-karim", "SHOWCAUSE_REPLY")).toBe(true);
  });

  it("a manager reads neither, show-cause or not", () => {
    const boss = viewer("MANAGER");
    expect(canReadDocumentsOf(boss, "emp-karim", "emp-manager", "SHOWCAUSE_REPLY")).toBe(false);
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

describe("§5.2 — the old manager keeps the period and loses everything after", () => {
  const boss = viewer("MANAGER");
  const SELF = "emp-boss";
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
  const person = (managerId: string | null) => ({ id: "emp-karim", managerId });

  it("a current report is not limited at all", () => {
    expect(employeeRecordScope(boss, SELF, person(SELF), [])).toEqual({ limited: false });
  });

  it("HR sees everybody's record as it is now", () => {
    const hr = viewer("HR_EXECUTIVE");
    expect(employeeRecordScope(hr, "emp-hr", person("emp-someone"), [])).toEqual({ limited: false });
  });

  it("your own record is never limited", () => {
    expect(
      employeeRecordScope(boss, "emp-karim", person("emp-someone-else"), []),
    ).toEqual({ limited: false });
  });

  it("somebody who transferred away is limited to the transfer date", () => {
    expect(
      employeeRecordScope(boss, SELF, person("emp-new-boss"), [
        { effectiveFrom: day("2024-01-01"), effectiveTo: day("2026-03-12") },
      ]),
    ).toEqual({ limited: true, until: day("2026-03-12") });
  });

  it("two spells under the same manager end at the later one", () => {
    // Somebody can come back to a team. The boundary is the end of the LAST
    // spell, not the first one the query happens to return.
    expect(
      employeeRecordScope(boss, SELF, person("emp-new-boss"), [
        { effectiveFrom: day("2020-01-01"), effectiveTo: day("2021-06-30") },
        { effectiveFrom: day("2024-01-01"), effectiveTo: day("2026-03-12") },
      ]),
    ).toEqual({ limited: true, until: day("2026-03-12") });
  });

  it("an open-ended past spell that disagrees with the pointer gives nothing", () => {
    // The history says still-managing, the current pointer says otherwise.
    // Read the strict way: a bookkeeping slip must not hand over a live record.
    expect(
      employeeRecordScope(boss, SELF, person("emp-new-boss"), [
        { effectiveFrom: day("2024-01-01"), effectiveTo: null },
      ]),
    ).toBeNull();
  });

  it("somebody who never reported to them gives nothing", () => {
    expect(employeeRecordScope(boss, SELF, person("emp-new-boss"), [])).toBeNull();
  });

  it("a viewer with no employee record of their own gives nothing", () => {
    expect(employeeRecordScope(boss, null, person("emp-new-boss"), [])).toBeNull();
  });
});
