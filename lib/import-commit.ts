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

/**
 * The cost factor for a password nobody will ever be told.
 *
 * A cost factor buys resistance to cracking a password a HUMAN chose, offline,
 * at leisure. These are 32 random characters generated, hashed and discarded
 * inside one expression — there is no plaintext anywhere for anybody to crack
 * back to. Imported employees are handed a real temporary password from the
 * accounts screen when HR is ready to hand one over, and `mustChangePassword`
 * forces a change even then.
 *
 * The number matters because it is multiplied by 412. At cost 10 this is 28
 * seconds of CPU and Vercel kills the request long before the end of it; at
 * cost 4 it is under a second. Every password a person will actually type is
 * still hashed at 10 — `app/actions/auth.ts` and `scripts/create-account.ts`.
 */
const UNUSED_PASSWORD_COST = 4;

export async function commitImport(
  actor: Importer,
  toWrite: CheckedRow[],
  options: { fileName: string; skipped: number; ip?: string },
): Promise<{ letter: string; nextNumber: number }> {
  const actorName = actor.name;
  const ip = options.ip ?? "";

  const lookups = await loadLookups();

  // Hashed out here, not row by row inside the transaction. CPU spent inside a
  // transaction holds a database connection and a set of locks for the whole
  // of it while doing nothing that needs a database.
  const hashes = await Promise.all(
    toWrite.map(() => bcrypt.hash(generatePassword(32), UNUSED_PASSWORD_COST)),
  );

  const branchOf = (row: CheckedRow) => lookups.branch.get(key(row.branch)) ?? null;
  const departmentOf = (row: CheckedRow) => lookups.department.get(key(row.department)) ?? null;
  const designationOf = (row: CheckedRow) => lookups.designation.get(key(row.designation)) ?? null;
  const gradeOf = (row: CheckedRow) => lookups.grade.get(key(row.grade)) ?? null;

  // One transaction for the whole file. A half-finished import of 412 people
  // is worse than none: nobody can tell afterwards which half went in.
  await prisma.$transaction(
    async (tx) => {
      // A handful of statements rather than four per person. The row-at-a-time
      // version ran about two thousand sequential round trips for 412 rows,
      // and a round trip to a pooled database in another process is the whole
      // cost — it does not matter that each one is small when they are waited
      // for one after another.
      const users = await tx.user.createManyAndReturn({
        data: toWrite.map((row, index) => ({
          email: row.email,
          // A password nobody knows. See UNUSED_PASSWORD_COST above.
          passwordHash: hashes[index]!,
          role: row.role as never,
          mustChangePassword: true,
          createdById: actor.userId,
          createdByName: actorName,
        })),
        select: { id: true, email: true },
      });
      // Matched by email rather than by position. Correctness should not rest
      // on the driver handing rows back in the order they were sent.
      const userIdByEmail = new Map(users.map((u) => [u.email, u.id]));

      const employees = await tx.employee.createManyAndReturn({
        data: toWrite.map((row) => ({
          userId: userIdByEmail.get(row.email)!,
          employeeId: row.employeeId,
          // Non-null: `checkImport` has already refused any row whose ID does
          // not parse, and nothing reaches here that it did not pass.
          ...(({ letter, number, year }) => ({ idLetter: letter, idNumber: number, idYear: year }))(
            parseEmployeeId(row.employeeId)!,
          ),
          fullName: row.fullName,
          mobile: row.mobile,
          staffType: row.staffType,
          // §12.1: "Existing employees are created directly at Stage 2 — they do
          // not go through the locked door, because they are already employed
          // and their files already exist."
          onboardingStatus: "APPROVED" as const,
          approvedAt: new Date(),
          approvedByName: `${actorName} (bulk import)`,
          joiningDate: row.joiningDate,
          confirmationDate: row.confirmationDate,
          branchId: branchOf(row),
          departmentId: departmentOf(row),
          designationId: designationOf(row),
          gradeId: gradeOf(row),
        })),
        select: { id: true, employeeId: true },
      });
      const idByCode = new Map(employees.map((e) => [e.employeeId!, e.id]));

      // Managers are resolved after everybody exists, because a manager may
      // appear later in the file than the people who report to them — and may
      // not be in the file at all, having been imported in an earlier run.
      const outsideFile = [
        ...new Set(
          toWrite
            .map((r) => r.manager)
            .filter((code): code is string => Boolean(code) && !idByCode.has(code)),
        ),
      ];
      if (outsideFile.length) {
        const found = await tx.employee.findMany({
          where: { employeeId: { in: outsideFile } },
          select: { id: true, employeeId: true },
        });
        for (const person of found) idByCode.set(person.employeeId!, person.id);
      }
      const managerOf = (row: CheckedRow) =>
        row.manager ? (idByCode.get(row.manager) ?? null) : null;

      await tx.employeeAssignment.createMany({
        data: toWrite.map((row) => ({
          employeeId: idByCode.get(row.employeeId)!,
          effectiveFrom: row.joiningDate,
          branchId: branchOf(row),
          departmentId: departmentOf(row),
          designationId: designationOf(row),
          gradeId: gradeOf(row),
          // Set here rather than patched afterwards: the assignment is the
          // authoritative history, and a row that is briefly wrong is a row
          // somebody can read while it is wrong.
          managerId: managerOf(row),
          reason: "IMPORT" as const,
          note: "Imported from the existing employee spreadsheet",
          recordedById: actor.userId,
          recordedByName: actorName,
        })),
      });

      const certificates = toWrite.filter(
        (row) => row.staffType === "RM" && row.certificateNumber && row.certificateExpiry,
      );
      if (certificates.length) {
        await tx.rmCertificate.createMany({
          data: certificates.map((row) => ({
            employeeId: idByCode.get(row.employeeId)!,
            certificateNumber: row.certificateNumber,
            issueDate: row.certificateIssue ?? row.joiningDate,
            expiryDate: row.certificateExpiry!,
            status: "ACTIVE" as const,
            recordedById: actor.userId,
            recordedByName: actorName,
          })),
        });
      }

      // The cached current manager on Employee, one statement per distinct
      // manager rather than one per person — a company of 412 has tens of
      // managers, not hundreds.
      const reportsByManager = new Map<string, string[]>();
      for (const row of toWrite) {
        const managerId = managerOf(row);
        if (!managerId) continue;
        const existing = reportsByManager.get(managerId);
        if (existing) existing.push(idByCode.get(row.employeeId)!);
        else reportsByManager.set(managerId, [idByCode.get(row.employeeId)!]);
      }
      for (const [managerId, ids] of reportsByManager) {
        await tx.employee.updateMany({ where: { id: { in: ids } }, data: { managerId } });
      }

      await record({
        action: "employee.imported",
        actor: actorFrom({ id: actor.userId, fullName: actorName, role: actor.role }),
        targetType: "import",
        targetLabel: `${toWrite.length} existing employees`,
        detail: {
          rows: toWrite.length,
          skippedAlreadyPresent: options.skipped,
          fileName: options.fileName,
        },
        ip,
        tx,
      });
    },
    // Generous, but no longer load-bearing: the slow part used to be inside.
    { timeout: 120_000, maxWait: 20_000 },
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
