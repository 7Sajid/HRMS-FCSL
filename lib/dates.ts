/**
 * Time, stated once.
 *
 * Vercel runs in UTC and FCSL works in Dhaka, six hours ahead. A bare
 * `toLocaleString()` on a server render therefore shows the wrong day for six
 * hours out of every twenty-four — and it shows it on leave dates, attendance
 * sheets and certificate expiries, which are exactly the things people argue
 * about. Every date the user sees goes through this file.
 *
 * Two kinds of value live here and they are not the same thing:
 *
 *   - An **instant** — when something happened. Stored `@db.Timestamptz(3)`,
 *     formatted in Dhaka.
 *   - A **calendar date** — a joining date, a leave day, an expiry. Stored
 *     `@db.Date`, which Prisma hands back as a JS Date at UTC midnight. It has
 *     no time and no zone: 14 March 2027 is 14 March 2027 in Dhaka, in London
 *     and in the database. All arithmetic on these is done in UTC, so it can
 *     never drift by a day.
 */

export const FCSL_TIME_ZONE = "Asia/Dhaka";

/** Friday and Saturday, per §12.2. `getUTCDay()`: 0 = Sunday … 6 = Saturday. */
export const WEEKLY_OFF_FRI_SAT: readonly number[] = [5, 6];

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: FCSL_TIME_ZONE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: FCSL_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: FCSL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "09 Aug 2026" */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return dateFormatter.format(d);
}

/** "09 Aug 2026, 14:18" */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return `${dateFormatter.format(d)}, ${timeFormatter.format(d)}`;
}

/** The Dhaka calendar date an instant falls on, as UTC midnight. */
export function dhakaDateOnly(value: Date = new Date()): Date {
  const [year, month, day] = partsFormatter.format(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/** Today in Dhaka, as a calendar date. */
export function todayInDhaka(): Date {
  return dhakaDateOnly(new Date());
}

/** A calendar date from its parts. `month` is 1-12, as a human writes it. */
export function calendarDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** "2026-09-06" — the form used in URLs, CSV exports and `<input type="date">`. */
export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Parse "2026-09-06" into a calendar date. Returns null rather than an Invalid
 * Date, because an invalid date silently poisons every comparison it touches.
 */
export function fromISODate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  // Rejects 2026-02-31, which Date would happily roll into March.
  return toISODate(date) === value.trim() ? date : null;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * The same calendar date `years` later, or earlier if negative.
 *
 * 29 February lands on 28 February in a year without one, rather than rolling
 * into March the way Date would — a leave year that starts on somebody's
 * joining anniversary must not start a day late every non-leap year.
 */
export function addYears(date: Date, years: number): Date {
  const year = date.getUTCFullYear() + years;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

/** Whole days from `from` to `to`. Negative if `to` is earlier. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Every calendar date from `from` to `to`, both ends included. */
export function eachDate(from: Date, to: Date): Date[] {
  if (to < from) return [];
  const out: Date[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The Dhaka instant at which a calendar date begins — for range queries. */
export function startOfDhakaDay(date: Date): Date {
  // Dhaka is UTC+6 with no daylight saving, so midnight local is 18:00 UTC the
  // previous day. Stated as a constant rather than computed, because the value
  // is a fact about Bangladesh, not about the runtime's clock.
  return new Date(date.getTime() - 6 * 3_600_000);
}

/** Half-open instant range covering the Dhaka days `from`..`to` inclusive. */
export function dhakaRange(from: Date, to: Date): { gte: Date; lt: Date } {
  return { gte: startOfDhakaDay(from), lt: startOfDhakaDay(addDays(to, 1)) };
}

// ---------------------------------------------------------------------------
// Working days
//
// Leave is counted in working days, and so are the two- and three-working-day
// reminders in §7.3 and §8. Both need the same two facts — which weekdays are
// off, and which dates are public holidays — so both take them as arguments.
// Nothing here reads the database: this file has to run inside a test.
// ---------------------------------------------------------------------------

export type DayKind = "WORKING" | "WEEKLY_OFF" | "HOLIDAY";

/** Holiday dates as a set of ISO strings, which is how callers will hold them. */
export type HolidaySet = ReadonlySet<string>;

export function isWeeklyOff(date: Date, weeklyOffDays: readonly number[] = WEEKLY_OFF_FRI_SAT): boolean {
  return weeklyOffDays.includes(date.getUTCDay());
}

/**
 * What kind of day this is.
 *
 * Weekly off wins over a public holiday that falls on the same date. Both are
 * non-working and both cost zero leave days, so the choice only affects what
 * the attendance grid prints — and a person looking at a Friday expects to
 * read "Weekly off", not to be told Eid fell on a day they were not working.
 */
export function dayKind(
  date: Date,
  holidays: HolidaySet = new Set(),
  weeklyOffDays: readonly number[] = WEEKLY_OFF_FRI_SAT,
): DayKind {
  if (isWeeklyOff(date, weeklyOffDays)) return "WEEKLY_OFF";
  if (holidays.has(toISODate(date))) return "HOLIDAY";
  return "WORKING";
}

/**
 * How many working days a leave range actually costs. This is the number the
 * employee sees before they press send — "four calendar days, two working
 * days" — so it has to match what the approver and the balance later agree.
 */
export function workingDaysBetween(
  from: Date,
  to: Date,
  holidays: HolidaySet = new Set(),
  weeklyOffDays: readonly number[] = WEEKLY_OFF_FRI_SAT,
): number {
  return eachDate(from, to).filter((d) => dayKind(d, holidays, weeklyOffDays) === "WORKING").length;
}

/**
 * The date `count` working days after `from`, not counting `from` itself.
 * Used for "amber after three working days" and the attendance deadline —
 * a request raised on Thursday is not overdue on Sunday.
 */
export function addWorkingDays(
  from: Date,
  count: number,
  holidays: HolidaySet = new Set(),
  weeklyOffDays: readonly number[] = WEEKLY_OFF_FRI_SAT,
): Date {
  let cursor = from;
  let remaining = count;
  // Bounded so a holiday table that somehow marks every day non-working cannot
  // spin forever on a server render.
  let guard = 0;
  while (remaining > 0 && guard < 3650) {
    cursor = addDays(cursor, 1);
    if (dayKind(cursor, holidays, weeklyOffDays) === "WORKING") remaining -= 1;
    guard += 1;
  }
  return cursor;
}

/** Working days elapsed since `from`, for "waiting 4 working days" counters. */
export function workingDaysSince(
  from: Date,
  holidays: HolidaySet = new Set(),
  weeklyOffDays: readonly number[] = WEEKLY_OFF_FRI_SAT,
  today: Date = todayInDhaka(),
): number {
  if (today <= from) return 0;
  return eachDate(addDays(from, 1), today).filter(
    (d) => dayKind(d, holidays, weeklyOffDays) === "WORKING",
  ).length;
}

// ---------------------------------------------------------------------------
// Plain-words durations
//
// §5.1 asks for "Valid. Expires 14 March 2027 — 6 months and 11 days
// remaining." A bare date does not make anybody act; a countdown does.
// ---------------------------------------------------------------------------

/** "6 months and 11 days", "17 days", "1 year and 2 months", "today". */
export function humanDaysUntil(target: Date, today: Date = todayInDhaka()): string {
  const days = daysBetween(today, target);
  if (days === 0) return "today";
  const magnitude = Math.abs(days);
  if (magnitude < 31) return `${magnitude} day${magnitude === 1 ? "" : "s"}`;

  // Calendar months, not 30-day blocks — "4 months" has to mean the same thing
  // to the person reading it as it does to the four-month warning that fired.
  const [earlier, later] = days > 0 ? [today, target] : [target, today];
  let months =
    (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 +
    (later.getUTCMonth() - earlier.getUTCMonth());
  const anchor = new Date(earlier.getTime());
  anchor.setUTCMonth(anchor.getUTCMonth() + months);
  if (anchor > later) {
    months -= 1;
    anchor.setUTCMonth(anchor.getUTCMonth() - 1);
  }
  const remainder = daysBetween(anchor, later);

  const years = Math.floor(months / 12);
  const leftoverMonths = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  if (leftoverMonths > 0) parts.push(`${leftoverMonths} month${leftoverMonths === 1 ? "" : "s"}`);
  if (remainder > 0 && years === 0) parts.push(`${remainder} day${remainder === 1 ? "" : "s"}`);
  return parts.join(" and ") || "less than a day";
}

/** Month name for grid headings and report titles: "March 2026". */
export function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

/** Number of days in a Gregorian month. `month` is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
