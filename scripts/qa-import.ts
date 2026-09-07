import { readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/csv";
import { checkImport, toRawRows } from "../lib/import";
import { prisma, finish } from "./_cli";

/**
 * The import validator against the kind of spreadsheet FCSL will actually
 * send: one with mistakes in it.
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

async function main() {
  const scratch = process.argv[2] ?? ".";
  const broken = parseCsv(readFileSync(path.join(scratch, "staff-broken.csv"), "utf8"));
  const clean = parseCsv(readFileSync(path.join(scratch, "staff-clean.csv"), "utf8"));

  console.log("\nA spreadsheet with mistakes in it");
  // The claim is that the dry run WRITES NOTHING, so it is measured as a
  // change across the run. Asking whether a name exists at all fails the
  // moment somebody has legitimately imported that person before — which is
  // an assertion about the database's history, not about the importer.
  const employeesBefore = await prisma.employee.count();
  const bad = checkImport(broken.headers, toRawRows(broken.headers, broken.rows));
  const messages = bad.problems.map((p) => `row ${p.row} ${p.column}: ${p.message}`);

  check("it reports problems rather than importing", bad.problems.length > 0, `${bad.problems.length} found`);
  check(
    "the duplicate employee ID is caught",
    messages.some((m) => /A 002 - 19 - 70 appears more than once/.test(m)),
  );
  check(
    "the malformed ID is caught",
    messages.some((m) => /EMP-004/.test(m) && /not the format/.test(m)),
  );
  check(
    "an ID whose year disagrees with the joining date is caught",
    messages.some((m) => /ID says 2019 but the joining date is 2022/.test(m)),
  );
  check("a date in the wrong format is caught", messages.some((m) => /Use YYYY-MM-DD/.test(m)));
  check("a short mobile number is caught", messages.some((m) => /Mobile/.test(m)));
  check("an unknown role is caught", messages.some((m) => /WIZARD/.test(m)));
  check(
    "every problem is reported, not just the first",
    new Set(bad.problems.map((p) => p.row)).size >= 4,
    `${new Set(bad.problems.map((p) => p.row)).size} rows flagged`,
  );
  check(
    "a column it does not know is reported rather than dropped silently",
    bad.unknownColumns.includes("Blood group"),
    bad.unknownColumns.join(", "),
  );
  const employeesAfter = await prisma.employee.count();
  check(
    "nothing was written",
    employeesAfter === employeesBefore,
    `${employeesBefore} before, ${employeesAfter} after`,
  );

  console.log("\nThe same spreadsheet, corrected");
  const good = checkImport(clean.headers, toRawRows(clean.headers, clean.rows));
  check("no problems", good.problems.length === 0, JSON.stringify(good.problems.slice(0, 3)));
  check("nothing required is missing", good.missingColumns.length === 0);
  check("all four rows read", good.rows.length === 4, String(good.rows.length));
  check(
    "the RM certificate dates come through",
    good.rows[1]!.certificateExpiry?.toISOString().slice(0, 10) === "2026-11-30",
  );
  check(
    "the manager is carried as an employee ID, to be linked in a second pass",
    good.rows[1]!.manager === "A 001 - 19 - 70",
  );
  check(
    "staff and RM are told apart",
    good.rows[0]!.staffType === "STAFF" && good.rows[1]!.staffType === "RM",
  );

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
