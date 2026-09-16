import { readFileSync } from "node:fs";
import { parseCsv } from "../lib/csv";
import { checkImport, toRawRows } from "../lib/import";
import { commitImport } from "../lib/import-commit";
import { args, die, finish, prisma, required } from "./_cli";

/**
 * The 412 existing employees, from the terminal.
 *
 * Same library the screen uses, so there is one implementation of the rules.
 * Dry by default — nothing is written unless --commit is given AND the file is
 * clean, because a partial import of 412 people is worse than none: nobody can
 * tell afterwards which half went in.
 *
 *   npm run hrm:import -- --file employees.csv
 *   npm run hrm:import -- --file employees.csv --commit
 */

const USAGE = "npm run hrm:import -- --file employees.csv [--commit]";

async function main() {
  const values = args();
  const file = required(values, "file", USAGE);
  const commit = values.commit === true;

  const { headers, rows } = parseCsv(readFileSync(file, "utf8"));
  if (!headers.length) die("That file has no header row.");

  const checked = checkImport(headers, toRawRows(headers, rows));

  console.log(`\n${rows.length} rows read from ${file}\n`);

  if (checked.missingColumns.length) {
    console.log("Columns the file does not have:");
    for (const column of checked.missingColumns) console.log(`  · ${column}`);
    console.log("");
  }
  if (checked.unknownColumns.length) {
    console.log("Columns this does not recognise, and will ignore:");
    for (const column of checked.unknownColumns) console.log(`  · ${column}`);
    console.log("");
  }

  if (checked.problems.length) {
    console.log(`${checked.problems.length} problems:\n`);
    for (const problem of checked.problems) {
      console.log(`  row ${String(problem.row).padStart(4)}  ${problem.column.padEnd(22)} ${problem.message}`);
    }
    console.log("\nNothing has been saved. Fix the spreadsheet and run it again.\n");
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.employee.findMany({
    where: {
      OR: [
        { employeeId: { in: checked.rows.map((r) => r.employeeId) } },
        { user: { email: { in: checked.rows.map((r) => r.email) } } },
      ],
    },
    select: { employeeId: true, user: { select: { email: true } } },
  });
  const presentIds = new Set(existing.map((e) => e.employeeId).filter(Boolean) as string[]);
  const presentEmails = new Set(existing.map((e) => e.user.email));
  const toWrite = checked.rows.filter(
    (r) => !presentIds.has(r.employeeId) && !presentEmails.has(r.email),
  );
  const skipped = checked.rows.length - toWrite.length;

  console.log(`✓ nothing wrong with this file`);
  if (skipped) console.log(`· ${skipped} already in the system — skipped, not an error`);
  console.log(`· ${toWrite.length} would be imported`);

  if (!commit) {
    console.log("\nThis was a dry run. Nothing has been saved. Add --commit to write it.\n");
    return;
  }
  if (!toWrite.length) {
    console.log("\nNothing to do.\n");
    return;
  }

  const sequence = await commitImport(
    { userId: "cli", role: "HR_EXECUTIVE", name: "Command line" },
    toWrite,
    { fileName: file, skipped },
  );

  console.log(`\n✓ ${toWrite.length} imported, at Stage 2, with the IDs they already had.`);
  console.log(
    `✓ the running counter now starts at ${sequence.letter} ${String(sequence.nextNumber).padStart(3, "0")}\n`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
