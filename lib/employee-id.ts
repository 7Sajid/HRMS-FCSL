import type { Prisma } from "@prisma/client";
import { prisma } from "./db";

/**
 * The employee ID: `A XXX - YY - 70` (§12.1).
 *
 *   A    the letter block. Stays A until the running number reaches 999, then
 *        becomes B and the number restarts at 001. Each block holds 999 people.
 *   XXX  the running number, always three digits with leading zeros. It NEVER
 *        resets at the year end and NO NUMBER IS EVER REUSED, including after
 *        somebody leaves.
 *   YY   the last two digits of the joining year. Never changes afterwards.
 *   70   fixed. Always 70, for everybody, for ever.
 *
 * FCSL's highest existing ID is A 412 - 26 - 70, so the next is A 413 - 26 - 70
 * and the first 2027 joiner is A 415 - 27 - 70 — the number carries on, only
 * the year changes.
 */

export const ID_SUFFIX = "70";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const MAX_NUMBER = 999;

export type EmployeeIdParts = { letter: string; number: number; year: number };

/** "A 413 - 26 - 70" — spaced exactly as the specification prints it. */
export function formatEmployeeId(parts: EmployeeIdParts): string {
  const yy = String(parts.year % 100).padStart(2, "0");
  return `${parts.letter} ${String(parts.number).padStart(3, "0")} - ${yy} - ${ID_SUFFIX}`;
}

/**
 * Read an ID back into its parts, or null.
 *
 * Whitespace is forgiving because these are typed by hand during the import
 * and read off printed lists; everything else is not. A shape that is nearly
 * right is the dangerous case — it must be rejected, not guessed at.
 */
export function parseEmployeeId(value: string): EmployeeIdParts | null {
  const match = /^([A-Z])\s*(\d{3})\s*-\s*(\d{2})\s*-\s*(\d{2})$/.exec(value.trim().toUpperCase());
  if (!match) return null;
  const [, letter, number, yy, suffix] = match;
  if (suffix !== ID_SUFFIX) return null;
  const parsed = Number(number);
  if (parsed < 1 || parsed > MAX_NUMBER) return null;
  // Two digits cannot say which century, and this system will not outlive the
  // ambiguity: 26 is 2026, not 1926.
  return { letter, number: parsed, year: 2000 + Number(yy) };
}

/** The state of the counter after issuing the number it currently holds. */
export function advance(state: { letter: string; nextNumber: number }): {
  letter: string;
  nextNumber: number;
} {
  if (state.nextNumber < MAX_NUMBER) {
    return { letter: state.letter, nextNumber: state.nextNumber + 1 };
  }
  const index = LETTERS.indexOf(state.letter);
  if (index < 0 || index === LETTERS.length - 1) {
    // Z 999 is 25,974 people. If FCSL ever gets here somebody must decide what
    // comes next; guessing at AA would produce an ID that does not match the
    // format anybody has agreed to.
    throw new Error(
      `Employee ID block ${state.letter} is full and there is no block after Z. ` +
        "The ID format needs a decision before another employee can be added.",
    );
  }
  return { letter: LETTERS[index + 1], nextNumber: 1 };
}

/**
 * Take the next ID.
 *
 * MUST run inside a transaction, and takes a row lock on the counter, so two
 * HR Executives pressing Approve at the same moment cannot be handed the same
 * number. Without the lock both would read 413, both would write 414, and two
 * people would carry A 413 - 26 - 70 — which the unique index would then
 * reject for the second, losing whichever approval landed second.
 */
export async function allocateEmployeeId(
  tx: Prisma.TransactionClient,
  joiningYear: number,
): Promise<{ employeeId: string; parts: EmployeeIdParts }> {
  const rows = await tx.$queryRaw<{ letter: string; nextNumber: number }[]>`
    SELECT "letter", "nextNumber" FROM "EmployeeIdSequence" WHERE "id" = 1 FOR UPDATE
  `;
  const current = rows[0];
  if (!current) {
    throw new Error("The employee ID counter is missing. Run the seed before issuing IDs.");
  }

  const parts: EmployeeIdParts = {
    letter: current.letter,
    number: current.nextNumber,
    year: joiningYear,
  };
  const next = advance(current);

  await tx.employeeIdSequence.update({
    where: { id: 1 },
    data: { letter: next.letter, nextNumber: next.nextNumber },
  });

  return { employeeId: formatEmployeeId(parts), parts };
}

/**
 * Has anybody, ever, held this ID?
 *
 * §12.1: "the system will refuse an ID that has already been used by anybody,
 * ever." Employees are never deleted, so the Employee table is the complete
 * history and this question has a complete answer.
 */
export async function employeeIdIsTaken(employeeId: string): Promise<boolean> {
  const existing = await prisma.employee.findUnique({
    where: { employeeId },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Move the counter past every ID already in use.
 *
 * Run after the import of the 412 existing staff, so the next person to join
 * gets 413 rather than colliding with somebody already imported. Only ever
 * moves the counter FORWARD — winding it back would hand out a number
 * somebody already holds.
 */
export async function syncSequenceToHighestUsed(): Promise<{ letter: string; nextNumber: number }> {
  const used = await prisma.employee.findMany({
    where: { employeeId: { not: null } },
    select: { idLetter: true, idNumber: true },
  });

  let letter = "A";
  let highest = 0;
  for (const row of used) {
    if (!row.idLetter || row.idNumber === null) continue;
    const better =
      row.idLetter > letter || (row.idLetter === letter && row.idNumber > highest);
    if (better) {
      letter = row.idLetter;
      highest = row.idNumber;
    }
  }

  const target = highest === 0 ? { letter, nextNumber: 1 } : advance({ letter, nextNumber: highest });
  const current = await prisma.employeeIdSequence.findUnique({ where: { id: 1 } });

  if (current) {
    const currentIsAhead =
      current.letter > target.letter ||
      (current.letter === target.letter && current.nextNumber >= target.nextNumber);
    if (currentIsAhead) return { letter: current.letter, nextNumber: current.nextNumber };
  }

  await prisma.employeeIdSequence.upsert({
    where: { id: 1 },
    update: target,
    create: { id: 1, ...target },
  });
  return target;
}
