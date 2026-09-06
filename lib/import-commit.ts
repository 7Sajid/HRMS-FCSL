import type { Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { actorFrom, record } from "./audit";
import { parseEmployeeId, syncSequenceToHighestUsed } from "./employee-id";
import { generatePassword } from "./passwords";
import type { CheckedRow } from "./import";

/**
 * Writing an import.
 *
 * Lives here rather than in the server action so the CLI and the screen run
 * the same code, and so a test can call exactly what the screen calls instead
 * of re-staging the writes and then checking its own staging.
 */

export type Importer = { userId: string; role: Role; name: string };

export async function commitImport(
  actor: Importer,
  toWrite: CheckedRow[],
  options: { fileName: string; skipped: number; ip?: string },
): Promise<{ letter: string; nextNumber: number }> {
  const actorName = actor.name;
  const context = { user: { id: actor.userId, role: actor.role } };
  const ip = options.ip ?? "";
  const file = { name: options.fileName };
  const alreadyPresent = { length: options.skipped };

  const lookups = await loadLookups();
  // One transaction for the whole file. A half-finished import of 412 people
  // is worse than none: nobody can tell afterwards which half went in.
  await prisma.$transaction(
    async (tx) => {
      const created = new Map<string, string>();

      for (const row of toWrite) {
        const parts = parseEmployeeId(row.employeeId)!;
        const user = await tx.user.create({
          data: {
            email: row.email,
            // A password nobody knows. Existing staff are already employed, so
            // HR issues them a real temporary password when they are ready to
            // hand it over — not months earlier in a spreadsheet import.
            passwordHash: await bcrypt.hash(generatePassword(32), 10),
            role: row.role as never,
            mustChangePassword: true,
            createdById: context.user.id,
            createdByName: actorName,
          },
        });

        const employee = await tx.employee.create({
          data: {
            userId: user.id,
            employeeId: row.employeeId,
            idLetter: parts.letter,
            idNumber: parts.number,
            idYear: parts.year,
            fullName: row.fullName,
            mobile: row.mobile,
            staffType: row.staffType,
            // §12.1: "Existing staff are created directly at Stage 2 — they do
            // not go through the locked door, because they are already
            // employed and their files already exist."
            onboardingStatus: "APPROVED",
            approvedAt: new Date(),
            approvedByName: `${actorName} (bulk import)`,
            joiningDate: row.joiningDate,
            confirmationDate: row.confirmationDate,
            branchId: lookups.branch.get(key(row.branch)) ?? null,
            departmentId: lookups.department.get(key(row.department)) ?? null,
            designationId: lookups.designation.get(key(row.designation)) ?? null,
            gradeId: lookups.grade.get(key(row.grade)) ?? null,
          },
        });
        created.set(row.employeeId, employee.id);

        await tx.employeeAssignment.create({
          data: {
            employeeId: employee.id,
            effectiveFrom: row.joiningDate,
            branchId: lookups.branch.get(key(row.branch)) ?? null,
            departmentId: lookups.department.get(key(row.department)) ?? null,
            designationId: lookups.designation.get(key(row.designation)) ?? null,
            gradeId: lookups.grade.get(key(row.grade)) ?? null,
            reason: "IMPORT",
            note: "Imported from the existing staff spreadsheet",
            recordedById: context.user.id,
            recordedByName: actorName,
          },
        });

        if (row.staffType === "RM" && row.certificateNumber && row.certificateExpiry) {
          await tx.rmCertificate.create({
            data: {
              employeeId: employee.id,
              certificateNumber: row.certificateNumber,
              issueDate: row.certificateIssue ?? row.joiningDate,
              expiryDate: row.certificateExpiry,
              status: "ACTIVE",
              recordedById: context.user.id,
              recordedByName: actorName,
            },
          });
        }
      }

      // Managers are linked in a second pass, because a manager may appear
      // later in the file than the people who report to them.
      for (const row of toWrite) {
        if (!row.manager) continue;
        const managerId =
          created.get(row.manager) ??
          (await tx.employee.findUnique({ where: { employeeId: row.manager } }))?.id;
        if (!managerId) continue;
        const id = created.get(row.employeeId)!;
        await tx.employee.update({ where: { id }, data: { managerId } });
        await tx.employeeAssignment.updateMany({
          where: { employeeId: id, effectiveTo: null },
          data: { managerId },
        });
      }

      await record({
        action: "employee.imported",
        actor: actorFrom({ id: actor.userId, fullName: actorName, role: actor.role }),
        targetType: "import",
        targetLabel: `${toWrite.length} existing staff`,
        detail: {
          rows: toWrite.length,
          skippedAlreadyPresent: alreadyPresent.length,
          fileName: file.name,
        },
        ip,
        tx,
      });
    },
    // 412 rows of bcrypt is not fast. The default 5s would abort halfway.
    { timeout: 300_000, maxWait: 20_000 },
  );

  // §12.1: "The running counter is set to start at 413 once the import is
  // done." Only ever forward — winding it back would hand out a number
  // somebody already holds.
  return syncSequenceToHighestUsed();
}

function key(value: string): string {
  return value.trim().toLowerCase();
}

async function loadLookups() {
  const [branches, departments, designations, grades] = await Promise.all([
    prisma.branch.findMany(),
    prisma.department.findMany(),
    prisma.designation.findMany(),
    prisma.grade.findMany(),
  ]);
  return {
    // Branches match on name OR code, because a spreadsheet will use whichever
    // the person filling it in had to hand.
    branch: new Map([
      ...branches.map((b) => [key(b.name), b.id] as const),
      ...branches.map((b) => [key(b.code), b.id] as const),
    ]),
    department: new Map(departments.map((d) => [key(d.name), d.id])),
    designation: new Map(designations.map((d) => [key(d.name), d.id])),
    grade: new Map(grades.map((g) => [key(g.name), g.id])),
  };
}
