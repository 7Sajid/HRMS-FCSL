import type { AttendanceMark } from "@prisma/client";
import { calendarDate, dayKind, daysInMonth, toISODate, type HolidaySet } from "./dates";

/**
 * The monthly branch attendance sheet (§6.3).
 *
 * Attendance flows in one direction, once a month, through the branch manager.
 * There is no punch device and no self check-in in version 1 — a deliberate
 * choice rather than an oversight: it costs nothing, needs no hardware in any
 * branch, and the grid is shaped so machine data could later fill the same
 * cells with the manager correcting missing punches instead of typing
 * everything.
 */

/** What a cell may be set to, in the order a manager thinks about them. */
export const MARKS: { value: AttendanceMark; label: string; short: string }[] = [
  { value: "PRESENT", label: "Present", short: "P" },
  { value: "ABSENT", label: "Absent", short: "A" },
  { value: "LATE", label: "Late", short: "L" },
  { value: "OFFICIAL_DUTY", label: "On official duty outside the branch", short: "D" },
  { value: "ON_LEAVE", label: "On approved leave", short: "V" },
  { value: "PUBLIC_HOLIDAY", label: "Public holiday", short: "H" },
  { value: "WEEKLY_OFF", label: "Weekly off", short: "—" },
];

export const MARK_LABEL: Record<AttendanceMark, string> = Object.fromEntries(
  MARKS.map((m) => [m.value, m.label]),
) as Record<AttendanceMark, string>;

export const MARK_SHORT: Record<AttendanceMark, string> = Object.fromEntries(
  MARKS.map((m) => [m.value, m.short]),
) as Record<AttendanceMark, string>;

/**
 * The three a manager may NOT set, because the system already knows them and
 * §6.3 says they "cannot be contradicted".
 *
 * A manager marking somebody present on a day their leave was approved would
 * put the attendance sheet and the leave register into a disagreement that
 * nothing else in the system can settle.
 */
export const LOCKED_MARKS: readonly AttendanceMark[] = ["ON_LEAVE", "PUBLIC_HOLIDAY", "WEEKLY_OFF"];

export function isLockedMark(mark: AttendanceMark): boolean {
  return LOCKED_MARKS.includes(mark);
}

export type PrefilledCell = {
  date: Date;
  /** Set when the system already knows the answer; null when the manager types it. */
  mark: AttendanceMark | null;
  locked: boolean;
  /**
   * False on days this person was not employed — before they joined, or after
   * their last working day.
   *
   * These days are still RETURNED rather than skipped, so every row in the
   * grid has one cell per day of the month. A row that simply stopped early
   * would slide left under a shared header and put a person's Tuesday under
   * somebody else's Friday.
   */
  employed: boolean;
};

/**
 * The grid before the manager touches it.
 *
 * Approved leave, Fridays, Saturdays and public holidays are already filled in
 * and cannot be contradicted (§6.3).
 */
export function prefillMonth(
  year: number,
  month: number,
  options: {
    holidays: HolidaySet;
    weeklyOffDays: readonly number[];
    /** ISO dates this person has approved leave on. */
    onLeave: ReadonlySet<string>;
    /** Nothing before this — a person who joined mid-month. */
    from?: Date | null;
    /** Nothing after this — a leaver. */
    to?: Date | null;
  },
): PrefilledCell[] {
  const cells: PrefilledCell[] = [];
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const date = calendarDate(year, month, day);

    const employed =
      (!options.from || date >= options.from) && (!options.to || date <= options.to);
    if (!employed) {
      cells.push({ date, mark: null, locked: true, employed: false });
      continue;
    }

    const iso = toISODate(date);
    // Leave wins over a weekly off in the ORDER checked here only because a
    // weekly off inside a leave range costs nothing either way; what matters
    // is that neither can be overwritten.
    const kind = dayKind(date, options.holidays, options.weeklyOffDays);
    if (kind === "WEEKLY_OFF") {
      cells.push({ date, mark: "WEEKLY_OFF", locked: true, employed: true });
    } else if (kind === "HOLIDAY") {
      cells.push({ date, mark: "PUBLIC_HOLIDAY", locked: true, employed: true });
    } else if (options.onLeave.has(iso)) {
      cells.push({ date, mark: "ON_LEAVE", locked: true, employed: true });
    } else {
      cells.push({ date, mark: null, locked: false, employed: true });
    }
  }
  return cells;
}

/** What is still blank, so the manager is told before submitting rather than after. */
export function unfilled(cells: readonly PrefilledCell[], entered: ReadonlyMap<string, AttendanceMark>): number {
  return cells.filter((cell) => cell.employed && !cell.locked && !entered.has(toISODate(cell.date)))
    .length;
}

/**
 * Is this month finished enough to submit?
 *
 * A sheet with holes in it locks those holes in, since only HR can change it
 * afterwards — so the check is here rather than in a warning nobody reads.
 */
export function canSubmit(
  cells: readonly PrefilledCell[],
  entered: ReadonlyMap<string, AttendanceMark>,
): boolean {
  return unfilled(cells, entered) === 0;
}
