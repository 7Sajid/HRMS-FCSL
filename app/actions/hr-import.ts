"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { parseCsv } from "@/lib/csv";
import { checkImport, toRawRows, type RowProblem } from "@/lib/import";
import { commitImport } from "@/lib/import-commit";

export type ImportResult =
  | {
      ok: true;
      committed: boolean;
      counted: number;
      problems: RowProblem[];
      unknownColumns: string[];
      missingColumns: string[];
      alreadyPresent: string[];
      sequence?: { letter: string; nextNumber: number };
    }
  | { error: string };

/**
 * §12.1 — "a bulk import screen that takes a spreadsheet, checks every row
 * before saving anything, and reports exactly which rows have a problem and
 * why."
 *
 * Dry by default. Nothing is written unless `commit` is set AND the file is
 * clean: a partial import of 412 employees is worse than none, because nobody can
 * tell afterwards which half went in.
 */
export async function importEmployees(
  _previous: unknown,
  formData: FormData,
): Promise<ImportResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "employees.setup")) return { error: "You cannot import employees." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 5 * 1024 * 1024) return { error: "That file is larger than 5 MB." };

  const commit = formData.get("commit") === "yes";
  const text = await file.text();
  const { headers, rows } = parseCsv(text);
  if (!headers.length) return { error: "That file has no header row." };

  const checked = checkImport(headers, toRawRows(headers, rows));

  // Anything already in the system is reported rather than treated as an
  // error: re-running the import after a fix should not fail on the rows that
  // already went in.
  const existing = await prisma.employee.findMany({
    where: {
      OR: [
        { employeeId: { in: checked.rows.map((r) => r.employeeId).filter(Boolean) } },
        { user: { email: { in: checked.rows.map((r) => r.email).filter(Boolean) } } },
      ],
    },
    select: { employeeId: true, user: { select: { email: true } } },
  });
  const presentIds = new Set(existing.map((e) => e.employeeId).filter(Boolean) as string[]);
  const presentEmails = new Set(existing.map((e) => e.user.email));
  const alreadyPresent = checked.rows
    .filter((r) => presentIds.has(r.employeeId) || presentEmails.has(r.email))
    .map((r) => `${r.employeeId} ${r.fullName}`);

  const toWrite = checked.rows.filter(
    (r) => !presentIds.has(r.employeeId) && !presentEmails.has(r.email),
  );

  const summary = {
    ok: true as const,
    committed: false,
    counted: toWrite.length,
    problems: checked.problems,
    unknownColumns: checked.unknownColumns,
    missingColumns: checked.missingColumns,
    alreadyPresent,
  };

  if (!commit) return summary;
  if (checked.problems.length || checked.missingColumns.length) {
    return { error: "Fix every problem below before committing. Nothing has been saved." };
  }
  if (!toWrite.length) return { ...summary, committed: true };

  const sequence = await commitImport(
    {
      userId: context.user.id,
      role: context.user.role,
      name: context.employee?.fullName ?? context.user.email,
    },
    toWrite,
    { fileName: file.name, skipped: alreadyPresent.length, ip: await currentIp() },
  );

  revalidatePath("/hr/import");
  revalidatePath("/hr/employees");
  return { ...summary, committed: true, sequence };
}
