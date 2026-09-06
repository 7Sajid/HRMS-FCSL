import { parseEmployeeId } from "./employee-id";
import { fromISODate } from "./dates";

/**
 * The bulk import of FCSL's 412 existing staff (§12.1).
 *
 * "There is a bulk import screen that takes a spreadsheet, checks every row
 * before saving anything, and reports exactly which rows have a problem and
 * why. Existing staff are created directly at Stage 2 — they do not go through
 * the locked door, because they are already employed and their files already
 * exist."
 *
 * Validation is a pure function over parsed rows, so the whole file can be
 * checked without touching the database and the dry run is genuinely dry.
 */

export type ImportColumn = {
  key: string;
  header: string;
  required: boolean;
  note: string;
};

/**
 * The columns this expects, until FCSL's real spreadsheet arrives. Headers are
 * matched case-insensitively with punctuation ignored, so "Employee ID",
 * "employee_id" and "EMPLOYEE ID" are the same column.
 */
export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: "employeeId", header: "Employee ID", required: true, note: "A 412 - 26 - 70" },
  { key: "fullName", header: "Full name", required: true, note: "" },
  { key: "email", header: "Email", required: true, note: "How they sign in. Must be unique." },
  { key: "mobile", header: "Mobile", required: false, note: "01712345678" },
  { key: "joiningDate", header: "Joining date", required: true, note: "YYYY-MM-DD" },
  { key: "role", header: "Role", required: false, note: "EMPLOYEE, MANAGER, HR_EXECUTIVE…" },
  { key: "staffType", header: "Staff or RM", required: false, note: "STAFF or RM" },
  { key: "branch", header: "Branch", required: false, note: "Branch name or code" },
  { key: "department", header: "Department", required: false, note: "" },
  { key: "designation", header: "Designation", required: false, note: "" },
  { key: "grade", header: "Grade", required: false, note: "" },
  { key: "manager", header: "Reports to", required: false, note: "Their manager's employee ID" },
  { key: "confirmationDate", header: "Confirmation date", required: false, note: "YYYY-MM-DD" },
  { key: "certificateNumber", header: "RM certificate number", required: false, note: "RMs only" },
  { key: "certificateIssue", header: "Certificate issued", required: false, note: "YYYY-MM-DD" },
  { key: "certificateExpiry", header: "Certificate expires", required: false, note: "YYYY-MM-DD" },
];

const BY_NORMALISED = new Map(
  IMPORT_COLUMNS.map((c) => [normalise(c.header), c.key]),
);

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type RawRow = Record<string, string>;

export type RowProblem = { row: number; column: string; message: string };

export type CheckedRow = {
  row: number;
  employeeId: string;
  fullName: string;
  email: string;
  mobile: string;
  joiningDate: Date;
  confirmationDate: Date | null;
  role: string;
  staffType: "STAFF" | "RM";
  branch: string;
  department: string;
  designation: string;
  grade: string;
  manager: string;
  certificateNumber: string;
  certificateIssue: Date | null;
  certificateExpiry: Date | null;
};

export type ImportCheck = {
  rows: CheckedRow[];
  problems: RowProblem[];
  /** Headers in the file that this does not recognise. */
  unknownColumns: string[];
  missingColumns: string[];
};

const ROLES = ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"];

/**
 * Check every row and report every problem — not just the first.
 *
 * Somebody fixing a 412-row spreadsheet needs the whole list, because
 * uploading it again to find the next single error is how a morning
 * disappears.
 */
export function checkImport(headers: string[], raw: RawRow[]): ImportCheck {
  const problems: RowProblem[] = [];
  const rows: CheckedRow[] = [];

  const mapped = headers.map((h) => BY_NORMALISED.get(normalise(h)) ?? null);
  const unknownColumns = headers.filter((_, i) => mapped[i] === null);
  const present = new Set(mapped.filter(Boolean) as string[]);
  const missingColumns = IMPORT_COLUMNS.filter((c) => c.required && !present.has(c.key)).map(
    (c) => c.header,
  );

  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();

  raw.forEach((row, index) => {
    // Row 1 is the header, so the first data row is 2 — which is what the
    // person staring at the spreadsheet sees.
    const line = index + 2;
    const get = (key: string) => (row[key] ?? "").trim();
    const fail = (column: string, message: string) => problems.push({ row: line, column, message });

    const employeeId = get("employeeId");
    const fullName = get("fullName");
    const email = get("email").toLowerCase();

    if (!employeeId) fail("Employee ID", "Missing.");
    else if (!parseEmployeeId(employeeId)) {
      fail("Employee ID", `"${employeeId}" is not the format A 412 - 26 - 70.`);
    } else if (seenIds.has(employeeId)) {
      fail("Employee ID", `${employeeId} appears more than once in this file.`);
    } else seenIds.add(employeeId);

    if (!fullName) fail("Full name", "Missing.");
    if (!email) fail("Email", "Missing.");
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Email", `"${email}" is not an email address.`);
    else if (seenEmails.has(email)) fail("Email", `${email} appears more than once in this file.`);
    else seenEmails.add(email);

    const joiningDate = fromISODate(get("joiningDate"));
    if (!get("joiningDate")) fail("Joining date", "Missing.");
    else if (!joiningDate) fail("Joining date", `"${get("joiningDate")}" is not a date. Use YYYY-MM-DD.`);

    // The year inside the ID has to agree with the joining date, because that
    // is what the ID means. A disagreement here is a typo somewhere.
    const parts = employeeId ? parseEmployeeId(employeeId) : null;
    if (parts && joiningDate && parts.year !== joiningDate.getUTCFullYear()) {
      fail(
        "Employee ID",
        `The ID says ${parts.year} but the joining date is ${joiningDate.getUTCFullYear()}.`,
      );
    }

    const confirmationDate = get("confirmationDate") ? fromISODate(get("confirmationDate")) : null;
    if (get("confirmationDate") && !confirmationDate) {
      fail("Confirmation date", `"${get("confirmationDate")}" is not a date.`);
    }

    const role = (get("role") || "EMPLOYEE").toUpperCase();
    if (!ROLES.includes(role)) fail("Role", `"${role}" is not one of ${ROLES.join(", ")}.`);

    const staffTypeRaw = (get("staffType") || "STAFF").toUpperCase();
    const staffType = staffTypeRaw === "RM" ? "RM" : "STAFF";
    if (!["STAFF", "RM"].includes(staffTypeRaw)) {
      fail("Staff or RM", `"${staffTypeRaw}" must be STAFF or RM.`);
    }

    const mobile = get("mobile");
    if (mobile && !/^01[3-9]\d{8}$/.test(mobile)) {
      fail("Mobile", `"${mobile}" is not an 11-digit Bangladeshi mobile number.`);
    }

    const certificateIssue = get("certificateIssue") ? fromISODate(get("certificateIssue")) : null;
    const certificateExpiry = get("certificateExpiry") ? fromISODate(get("certificateExpiry")) : null;
    if (get("certificateIssue") && !certificateIssue) fail("Certificate issued", "Not a date.");
    if (get("certificateExpiry") && !certificateExpiry) fail("Certificate expires", "Not a date.");
    if (certificateIssue && certificateExpiry && certificateExpiry <= certificateIssue) {
      fail("Certificate expires", "The expiry is not after the issue date.");
    }
    if (staffType === "RM" && get("certificateNumber") && !certificateExpiry) {
      fail("Certificate expires", "An RM certificate needs an expiry date to be tracked.");
    }

    rows.push({
      row: line,
      employeeId,
      fullName,
      email,
      mobile,
      joiningDate: joiningDate ?? new Date(0),
      confirmationDate,
      role,
      staffType,
      branch: get("branch"),
      department: get("department"),
      designation: get("designation"),
      grade: get("grade"),
      manager: get("manager"),
      certificateNumber: get("certificateNumber"),
      certificateIssue,
      certificateExpiry,
    });
  });

  return { rows, problems, unknownColumns, missingColumns };
}

/** Map a parsed sheet's headers onto our keys. */
export function toRawRows(headers: string[], cells: string[][]): RawRow[] {
  const keys = headers.map((h) => BY_NORMALISED.get(normalise(h)) ?? `__unknown_${normalise(h)}`);
  return cells.map((line) => {
    const row: RawRow = {};
    keys.forEach((key, i) => {
      row[key] = line[i] ?? "";
    });
    return row;
  });
}

/** A template for HR to fill in, so nobody has to guess the column names. */
export function templateCsvHeaders(): string[] {
  return IMPORT_COLUMNS.map((c) => c.header);
}
