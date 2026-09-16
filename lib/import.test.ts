import { describe, expect, it } from "vitest";
import { checkImport, templateCsvHeaders, toRawRows } from "./import";

const HEADERS = [
  "Employee ID",
  "Full name",
  "Email",
  "Mobile",
  "Joining date",
  "Role",
  "Executive or Associate",
];

const good = [
  ["A 001 - 19 - 70", "Rahim Uddin", "rahim@fcslbd.com", "01712345678", "2019-03-01", "MANAGER", "EXECUTIVE"],
  ["A 002 - 19 - 70", "Karim Hossain", "karim@fcslbd.com", "01812345678", "2019-06-15", "EMPLOYEE", "ASSOCIATE"],
];

const check = (rows: string[][], headers = HEADERS) =>
  checkImport(headers, toRawRows(headers, rows));

describe("a clean file passes", () => {
  it("reads every row with no problems", () => {
    const result = check(good);
    expect(result.problems).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.employeeId).toBe("A 001 - 19 - 70");
    expect(result.rows[1]!.staffType).toBe("RM");
  });

  it("matches headers however they are punctuated or cased", () => {
    const odd = [
      "employee_id", "FULL NAME", "E-mail", "mobile", "joining date", "role", "executive or associate",
    ];
    const result = check(good, odd);
    expect(result.problems).toEqual([]);
    expect(result.unknownColumns).toEqual([]);
    expect(result.rows[1]!.staffType).toBe("RM");
  });

  // A sheet drafted before the 16 September 2026 rename, header and values.
  // The column must still be recognised: an unknown header is reported but the
  // column falls back to its default, which would turn every Associate into an
  // executive without failing a single row.
  it("still understands the old Staff or RM column and its words", () => {
    const old = ["Employee ID", "Full name", "Email", "Mobile", "Joining date", "Role", "Staff or RM"];
    const rows = [
      ["A 001 - 19 - 70", "Rahim Uddin", "rahim@fcslbd.com", "01712345678", "2019-03-01", "MANAGER", "STAFF"],
      ["A 002 - 19 - 70", "Karim Hossain", "karim@fcslbd.com", "01812345678", "2019-06-15", "EMPLOYEE", "RM"],
    ];
    const result = check(rows, old);
    expect(result.problems).toEqual([]);
    expect(result.unknownColumns).toEqual([]);
    expect(result.rows[0]!.staffType).toBe("STAFF");
    expect(result.rows[1]!.staffType).toBe("RM");
  });

  it("refuses a word that is neither", () => {
    const rows = [
      ["A 001 - 19 - 70", "Rahim Uddin", "rahim@fcslbd.com", "01712345678", "2019-03-01", "MANAGER", "PARTNER"],
    ];
    expect(check(rows).problems).toEqual([
      { row: 2, column: "Executive or Associate", message: '"PARTNER" must be EXECUTIVE or ASSOCIATE.' },
    ]);
  });

  it("defaults role and person type when the columns are absent", () => {
    const minimal = ["Employee ID", "Full name", "Email", "Joining date"];
    const result = check([["A 003 - 20 - 70", "Salma Begum", "salma@fcslbd.com", "2020-01-05"]], minimal);
    expect(result.problems).toEqual([]);
    expect(result.rows[0]!.role).toBe("EMPLOYEE");
    expect(result.rows[0]!.staffType).toBe("STAFF");
  });
});

describe("it reports EVERY problem, not just the first", () => {
  it("collects problems across rows and columns", () => {
    const bad = [
      ["not-an-id", "", "not-an-email", "123", "nope", "WIZARD", "MAYBE"],
      ["A 004 - 20 - 70", "Fine Person", "fine@fcslbd.com", "01712345678", "2020-01-01", "EMPLOYEE", "STAFF"],
    ];
    const result = check(bad);
    // Somebody fixing a 412-row spreadsheet needs the whole list — uploading
    // again to find the next single error is how a morning disappears.
    expect(result.problems.length).toBeGreaterThanOrEqual(6);
    expect(result.problems.every((p) => p.row === 2)).toBe(true);
  });

  it("numbers rows as the spreadsheet does, with the header as row 1", () => {
    const result = check([["", "", "", "", "", "", ""]]);
    expect(result.problems[0]!.row).toBe(2);
  });
});

describe("the checks that catch a real typo", () => {
  it("catches an ID that is not the FCSL format", () => {
    const result = check([["EMP-001", "A", "a@b.com", "", "2020-01-01", "", ""]]);
    expect(result.problems.some((p) => /not the format A 412 - 26 - 70/.test(p.message))).toBe(true);
  });

  it("catches the same ID twice in one file", () => {
    const dupes = [
      ["A 001 - 19 - 70", "One", "one@fcslbd.com", "", "2019-01-01", "", ""],
      ["A 001 - 19 - 70", "Two", "two@fcslbd.com", "", "2019-01-01", "", ""],
    ];
    expect(check(dupes).problems.some((p) => /appears more than once/.test(p.message))).toBe(true);
  });

  it("catches the same email twice", () => {
    const dupes = [
      ["A 001 - 19 - 70", "One", "same@fcslbd.com", "", "2019-01-01", "", ""],
      ["A 002 - 19 - 70", "Two", "same@fcslbd.com", "", "2019-01-01", "", ""],
    ];
    expect(check(dupes).problems.some((p) => /same@fcslbd.com appears more than once/.test(p.message))).toBe(true);
  });

  it("catches an ID whose year disagrees with the joining date", () => {
    // The YY in the ID is the joining year, so a disagreement is a typo in one
    // of the two — and importing it would bake the wrong one in for ever.
    const result = check([["A 001 - 19 - 70", "One", "one@fcslbd.com", "", "2021-03-01", "", ""]]);
    expect(
      result.problems.some((p) => /The ID says 2019 but the joining date is 2021/.test(p.message)),
    ).toBe(true);
  });

  it("catches a date that is not a date", () => {
    const result = check([["A 001 - 19 - 70", "One", "one@fcslbd.com", "", "01/03/2019", "", ""]]);
    expect(result.problems.some((p) => /Use YYYY-MM-DD/.test(p.message))).toBe(true);
  });

  it("catches a mobile number that is not one", () => {
    const result = check([["A 001 - 19 - 70", "One", "one@fcslbd.com", "0171234", "2019-01-01", "", ""]]);
    expect(result.problems.some((p) => p.column === "Mobile")).toBe(true);
  });
});

describe("Associate certificates in the import", () => {
  const withCert = [
    "Employee ID",
    "Full name",
    "Email",
    "Joining date",
    "Executive or Associate",
    "Associate certificate number",
    "Certificate issued",
    "Certificate expires",
  ];

  it("accepts a complete certificate", () => {
    const result = check(
      [["A 005 - 21 - 70", "RM One", "rm1@fcslbd.com", "2021-01-01", "RM", "BSEC-1", "2025-01-01", "2027-01-01"]],
      withCert,
    );
    expect(result.problems).toEqual([]);
    expect(result.rows[0]!.certificateExpiry?.toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("refuses a certificate with no expiry, because there is nothing to count to", () => {
    const result = check(
      [["A 006 - 21 - 70", "RM Two", "rm2@fcslbd.com", "2021-01-01", "RM", "BSEC-2", "2025-01-01", ""]],
      withCert,
    );
    expect(result.problems.some((p) => /needs an expiry date/.test(p.message))).toBe(true);
  });

  it("refuses an expiry that is not after the issue", () => {
    const result = check(
      [["A 007 - 21 - 70", "RM Three", "rm3@fcslbd.com", "2021-01-01", "RM", "BSEC-3", "2027-01-01", "2025-01-01"]],
      withCert,
    );
    expect(result.problems.some((p) => /not after the issue date/.test(p.message))).toBe(true);
  });
});

describe("the shape of the file itself", () => {
  it("names required columns that are missing", () => {
    const result = check([["Somebody"]], ["Full name"]);
    expect(result.missingColumns).toContain("Employee ID");
    expect(result.missingColumns).toContain("Email");
    expect(result.missingColumns).toContain("Joining date");
  });

  it("reports columns it does not recognise rather than silently dropping them", () => {
    // FCSL's real spreadsheet will have columns we did not anticipate. Saying
    // so is how we find out what they are.
    const result = check([["A 001 - 19 - 70", "One", "one@fcslbd.com", "Blood group O+"]], [
      "Employee ID",
      "Full name",
      "Email",
      "Blood group",
    ]);
    expect(result.unknownColumns).toEqual(["Blood group"]);
  });

  it("offers a template with every column named", () => {
    expect(templateCsvHeaders()).toContain("Employee ID");
    expect(templateCsvHeaders()).toContain("Reports to");
  });
});
