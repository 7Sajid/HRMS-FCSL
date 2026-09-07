import { prisma } from "./db";
import { todayInDhaka, workingDaysSince } from "./dates";

/**
 * "Anything waiting over three working days moves to the top and turns amber."
 * (§5.4, and the same rule again in §8 for the nightly reminder.)
 *
 * Three working days is a default, not a constant. §12.2 gives the HR Head a
 * settings box for it — `approval.escalateAfterWorkingDays` — and a setting
 * nothing reads is worse than no setting at all, because the person who
 * changed it believes something happened.
 *
 * The rule lives here rather than in the two inbox components because there
 * are three callers and they must agree: the HR Head's inbox, the Super
 * Admin's, and the scheduled job that emails whoever is sitting on something.
 * Two of them had the number typed in by hand and neither looked at the
 * setting.
 */

export const DEFAULT_ESCALATE_AFTER_WORKING_DAYS = 3;

/** Weekends only. Public holidays would make the amber later, never sooner,
 *  and an approver on holiday is exactly who the reminder is for. */
const WEEKLY_OFF = [5, 6] as const;

export async function escalateAfterWorkingDays(): Promise<number> {
  const setting = await prisma.setting.findUnique({
    where: { key: "approval.escalateAfterWorkingDays" },
  });
  const value = Number(setting?.value);
  // A blank or corrupt setting falls back rather than escalating everything at
  // zero days, which would turn the whole inbox amber and teach people to
  // ignore the colour.
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ESCALATE_AFTER_WORKING_DAYS;
}

/** How long something has been sitting, in working days. */
export function waitedWorkingDays(since: Date, today: Date = todayInDhaka()): number {
  return workingDaysSince(since, new Set(), [...WEEKLY_OFF], today);
}

export function isOverdue(waited: number, threshold: number): boolean {
  return waited >= threshold;
}

/**
 * Longest-waiting first — the ordering the spec asks for, applied in one place
 * so leave and requisitions cannot drift into two different ideas of "top".
 */
export function byLongestWaiting<T>(items: readonly T[], since: (item: T) => Date, today?: Date): {
  item: T;
  waited: number;
}[] {
  return items
    .map((item) => ({ item, waited: waitedWorkingDays(since(item), today) }))
    .sort((a, b) => b.waited - a.waited);
}
