import type { LeaveDayKind } from "@prisma/client";
import { addDays, addYears, calendarDate, dayKind, eachDate, formatDate, toISODate, type HolidaySet } from "./dates";

/**
 * Leave arithmetic (§6.2).
 *
 * Everything here is a pure function over data the caller has already fetched,
 * so the rules that decide whether somebody may take a week off can be run in
 * a test without a database behind them.
 *
 * The shape this all rests on: a leave request is a header, and a leave DAY is
 * one row per calendar date in the range — weekends and public holidays
 * included, at zero length. The request therefore preserves the dates the
 * employee actually typed while contributing nothing to the balance, and no
 * calendar logic is needed at query time.
 */

// ---------------------------------------------------------------------------
// The leave year
//
// Each person's leave year runs from their joining date: somebody who joined on
// 1 June has a year from 1 June to 31 May. FCSL decided this on 10 September
// 2026. It replaced a calendar year, which needed a pro-rating rule for every
// joiner's first January; a year that starts when the person does needs none.
//
// Somebody with no joining date on record — never true of approved employees, but
// the column is nullable — falls back to the calendar year rather than to no
// year at all.
// ---------------------------------------------------------------------------

export type LeavePeriod = { from: Date; to: Date };

/** The leave year containing `date`, for somebody who joined on `joiningDate`. */
export function leaveYearOf(joiningDate: Date | null, date: Date): LeavePeriod {
  if (!joiningDate) {
    const year = date.getUTCFullYear();
    return { from: calendarDate(year, 1, 1), to: calendarDate(year, 12, 31) };
  }
  let years = date.getUTCFullYear() - joiningDate.getUTCFullYear();
  if (addYears(joiningDate, years) > date) years -= 1;
  // Both ends measured from the joining date, never from each other, so a
  // 29 February joiner's years stay back to back through non-leap years.
  return {
    from: addYears(joiningDate, years),
    to: addDays(addYears(joiningDate, years + 1), -1),
  };
}

/**
 * Every leave year a range of dates touches, in order.
 *
 * ponytail: stops after five. The longest application the HR Head allows is a
 * year (`leave.maximumDays`), so a real one touches two; this only bounds the
 * walk for a nonsense range that preflight is about to refuse anyway.
 */
export function leaveYearsSpanned(joiningDate: Date | null, from: Date, to: Date): LeavePeriod[] {
  const periods: LeavePeriod[] = [];
  let period = leaveYearOf(joiningDate, from);
  while (periods.length < 5) {
    periods.push(period);
    if (period.to >= to) break;
    period = leaveYearOf(joiningDate, addDays(period.to, 1));
  }
  return periods;
}

/**
 * The longest single application the system will take.
 *
 * There was no limit at all: 1 October 2026 to 1 October 2126 passed every
 * check and would have written 36,525 day rows in one request. Leave without
 * pay is not balance-checked, so nothing else stood in the way.
 *
 * A calendar-day span rather than a working-day cost, because the harm is the
 * number of rows and the size of the request, not the number of days off. The
 * HR Head sets the number; this is what it means when it is missing or
 * nonsense.
 */
export const DEFAULT_MAXIMUM_LEAVE_DAYS = 366;

export function maximumLeaveDays(setting: string | null | undefined): number {
  const parsed = Number(String(setting ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAXIMUM_LEAVE_DAYS;
  return Math.floor(parsed);
}

/**
 * Every leave year a range touches.
 *
 * Christmas week is the ordinary case: 28 December to 4 January is two leave
 * years, and everything about the application — which holidays apply, which
 * entitlement pays for it — has to be asked of both. Reading only the first
 * day's year meant January's public holidays were charged as working days and
 * January's days came off nobody's balance at all.
 */
export function yearsSpanned(from: Date, to: Date): number[] {
  const first = from.getUTCFullYear();
  const last = to.getUTCFullYear();
  if (last < first) return [first];
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

// ---------------------------------------------------------------------------
// Probation
//
// FCSL, 10 September 2026: somebody in their first year can still take casual
// and sick leave, but whatever they take comes out of the year they become
// permanent. In their words — take 3 days of casual and 2 of sick in probation,
// and "that year I will only have 3 casual leave ... and 4 sick leaves. Next
// year I'll have all 6, 6."
//
// Which types behave that way is a setting on the type, not a list of codes
// here: §12 puts leave types in the HR Head's hands.
//
//   NORMAL           its own grant every leave year, from the first day
//   ADVANCE          one grant covers probation AND the first permanent year
//   AFTER_PROBATION  nothing until probation ends (earned leave — Labour Act
//                    s.117 gives it after a year's service)
//
// ADVANCE is nothing more than a bucket with a longer validity window: it opens
// on the joining date and closes at the end of the first permanent year. FIFO,
// the balance and consumption only ever ask "which buckets cover this date?",
// so none of them had to learn a new rule — FCSL's example falls out of the
// arithmetic they already did.
// ---------------------------------------------------------------------------

export type ProbationPolicy = "NORMAL" | "ADVANCE" | "AFTER_PROBATION";

/**
 * The first day as a permanent employee: the confirmation date HR recorded,
 * otherwise a year after joining. Null for somebody with no joining date.
 */
export function probationEnds(joiningDate: Date | null, confirmationDate: Date | null): Date | null {
  if (!joiningDate) return null;
  return confirmationDate ?? addYears(joiningDate, 1);
}

export type GrantWindow = LeavePeriod & {
  /** The leave year whose rule sets how many days. */
  rulePeriod: LeavePeriod;
};

/**
 * Where the grant for `period` lives, or null if that period gets none.
 *
 * For an ADVANCE type every probation year and the first permanent year return
 * the SAME window. That is what makes it one bucket rather than a debt carried
 * from one bucket into the next.
 */
export function grantWindow(
  policy: ProbationPolicy,
  joiningDate: Date | null,
  confirmationDate: Date | null,
  period: LeavePeriod,
): GrantWindow | null {
  const own: GrantWindow = { ...period, rulePeriod: period };
  if (!joiningDate) return own;
  // Nothing for a year that ended before they arrived.
  if (period.to < joiningDate) return null;

  const ends = probationEnds(joiningDate, confirmationDate)!;
  const firstPermanent = leaveYearOf(joiningDate, ends);
  // Every year after the first permanent one is ordinary, whatever the type.
  if (policy === "NORMAL" || period.from > firstPermanent.from) return own;

  if (policy === "ADVANCE") {
    return { from: joiningDate, to: firstPermanent.to, rulePeriod: firstPermanent };
  }

  // AFTER_PROBATION: nothing while the whole year is probation, and in the year
  // probation ends, nothing before the day it ends.
  if (period.to < ends) return null;
  return { from: ends, to: period.to, rulePeriod: period };
}

// ---------------------------------------------------------------------------
// Dated rules
// ---------------------------------------------------------------------------

export type DatedRule<T> = T & { effectiveFrom: Date };

/**
 * The rule that was in force on a given date.
 *
 * §12.2: "Each change is dated, so old leave records keep their original
 * meaning." Last year's leave is calculated on last year's rule.
 */
export function ruleOn<T>(rules: readonly DatedRule<T>[], onDate: Date): DatedRule<T> | null {
  let best: DatedRule<T> | null = null;
  for (const rule of rules) {
    if (rule.effectiveFrom <= onDate && (!best || rule.effectiveFrom > best.effectiveFrom)) {
      best = rule;
    }
  }
  return best;
}

/**
 * The rule governing a whole leave year: the one in force on its first day.
 *
 * Leave years start on each person's own date, so "the rule for 2026" no longer
 * means anything. Asked on the first day, a change dated next January reaches
 * each person at their next anniversary instead of rewriting a year already
 * half spent. The one exception is a type created during somebody's year: it
 * has no rule on that year's first day, and its first rule is used rather than
 * leaving them without the type until next time.
 */
export function ruleForPeriod<T>(rules: readonly DatedRule<T>[], period: LeavePeriod): DatedRule<T> | null {
  const atStart = ruleOn(rules, period.from);
  if (atStart) return atStart;
  let first: DatedRule<T> | null = null;
  for (const rule of rules) {
    if (rule.effectiveFrom <= period.to && (!first || rule.effectiveFrom < first.effectiveFrom)) {
      first = rule;
    }
  }
  return first;
}

export function weeklyOffOn(
  rules: readonly DatedRule<{ days: number[] }>[],
  onDate: Date,
): readonly number[] {
  return ruleOn(rules, onDate)?.days ?? [5, 6];
}

// ---------------------------------------------------------------------------
// Building the days of an application
// ---------------------------------------------------------------------------

export type PlannedDay = { date: Date; dayKind: LeaveDayKind; lengthDays: number };

/**
 * One row per calendar date in the range, including the non-working ones.
 *
 * A half-day public holiday costs half a day of leave, which is why holidays
 * carry a flag rather than simply being excluded.
 */
export function planLeaveDays(
  from: Date,
  to: Date,
  holidays: HolidaySet,
  halfDayHolidays: HolidaySet = new Set(),
  weeklyOffDays: readonly number[] = [5, 6],
): PlannedDay[] {
  return eachDate(from, to).map((date) => {
    const kind = dayKind(date, holidays, weeklyOffDays);
    if (kind === "WEEKLY_OFF") return { date, dayKind: "WEEKLY_OFF" as const, lengthDays: 0 };
    if (kind === "HOLIDAY") return { date, dayKind: "HOLIDAY" as const, lengthDays: 0 };
    const half = halfDayHolidays.has(toISODate(date));
    return { date, dayKind: "WORKING" as const, lengthDays: half ? 0.5 : 1 };
  });
}

export function workingDayCost(days: readonly PlannedDay[]): number {
  return days.reduce((total, day) => total + day.lengthDays, 0);
}

// ---------------------------------------------------------------------------
// Balances
//
// Computed from the junction. There is deliberately no daysUsed counter to
// disagree with it.
// ---------------------------------------------------------------------------

export type Bucket = {
  id: string;
  fromDate: Date;
  toDate: Date;
  days: number;
  /**
   * True for days carried over from last year.
   *
   * They open on the same day as this year's grant, so a sort on `fromDate`
   * alone cannot tell them apart — and the whole point of drawing oldest-first
   * is that the carried days, which lapse at the end of this year, get used
   * before the ones that will carry again.
   */
  carriedForward?: boolean;
};

export type Balance = {
  /** Everything granted for the period. */
  entitled: number;
  /** Actually granted leave — the days that came off at final approval. */
  taken: number;
  /** Applied for and still travelling up the chain. */
  pending: number;
  /** entitled − taken. What §7.1 says has left the balance. */
  available: number;
  /** entitled − taken − pending. What can safely be applied for now. */
  applicable: number;
};

export function computeBalance(
  buckets: readonly Bucket[],
  consumedFromBuckets: number,
  pendingDays: number,
): Balance {
  const entitled = buckets.reduce((total, b) => total + b.days, 0);
  const available = round(entitled - consumedFromBuckets);
  return {
    entitled: round(entitled),
    taken: round(consumedFromBuckets),
    pending: round(pendingDays),
    available,
    applicable: round(available - pendingDays),
  };
}

/**
 * How many days carry into next year.
 *
 * §12 leaves the numbers to the HR Head — a type says whether it carries and
 * what the ceiling is, and this is the arithmetic in between. Earned leave
 * ships carrying forward with a cap of 40, and until now nothing anywhere
 * created the bucket: the setting was stored, printed on the settings screen
 * as "· carries forward", and silently did nothing. Unused earned leave simply
 * vanished every 31 December.
 *
 * Never negative, and never more than the cap.
 */
export function carriedForwardDays(
  granted: number,
  used: number,
  cap: number | null,
): number {
  const unused = round(Math.max(0, granted - used));
  if (unused <= 0) return 0;
  return cap === null ? unused : round(Math.min(unused, Math.max(0, cap)));
}

/**
 * Who a leave type is for (§6.2).
 *
 * Maternity leave is why this exists: 112 days of it were offered to every
 * employee in the company, men included, because nothing asked the question.
 *
 * The answer is read from the type's own `appliesTo` column rather than from
 * its code, because §12 settles that leave types are the HR Head's to
 * configure and are never hardcoded — FCSL may add paternity leave next year
 * and nobody should have to edit this file.
 */
export type Audience = "ALL" | "FEMALE" | "MALE";

export function normaliseGender(value: string): "FEMALE" | "MALE" | null {
  // HR types this by hand into a free-text field, so it arrives as "Female",
  // "female", "F", "M", "Male" and occasionally blank.
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text.startsWith("f") || text === "woman" || text === "w") return "FEMALE";
  if (text.startsWith("m")) return "MALE";
  return null;
}

export function audienceIncludes(appliesTo: Audience | null | undefined, gender: string): boolean {
  // Anything but a value we recognise means everybody.
  //
  // Not defensive programming for its own sake: this filter decides whether a
  // leave type appears AT ALL, so a value that matches nothing removes every
  // type from the screen and the person cannot apply for leave. Found exactly
  // that way — a running server holding a Prisma client generated before the
  // column existed read `appliesTo` as undefined, and the leave page said "HR
  // has not set up any leave types yet". Failing towards showing is the only
  // safe direction here.
  if (appliesTo !== "FEMALE" && appliesTo !== "MALE") return true;
  const recorded = normaliseGender(gender);
  // Nothing recorded: offer it anyway.
  //
  // The two mistakes are not the same size. Hiding maternity leave from a
  // woman because nobody typed her gender into her record denies a statutory
  // entitlement and she may never find out why it is missing. Offering it to a
  // man whose record is equally blank is an embarrassment on a dropdown. So
  // the doubt resolves towards offering, and the fix for the embarrassment is
  // to fill the record in.
  if (!recorded) return true;
  return recorded === appliesTo;
}

/**
 * Is this type counted against a balance at all?
 *
 * Leave without pay is nought days by definition and is deliberately allowed
 * to exceed that — the seed comment says so: "Zero entitlement by definition,
 * so it must be allowed to exceed it." Those two facts together mean it is not
 * an entitlement, it is a reason attached to an absence.
 *
 * Treating it as one produced "Leave without pay — -1 days left" on screen and
 * "you have -1 left, 1 more than the balance" in a warning. Neither is a
 * sentence about anything. Derived from the rule rather than from the code
 * "UNPAID", because §12 settles that leave types are configured by the HR Head
 * and never hardcoded — any type they set up this way behaves the same.
 */
export function isUncounted(entitled: number, overBalance: "REFUSE" | "WARN"): boolean {
  return entitled === 0 && overBalance === "WARN";
}

function round(value: number): number {
  // Leave is counted in half days; floating point should never leak a
  // 9.999999999 into a sentence a person reads.
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// FIFO consumption
// ---------------------------------------------------------------------------

export type Allocation = { leaveDayIndex: number; bucketId: string; lengthDays: number };

/**
 * Draw each leave day from the oldest valid bucket first.
 *
 * Oldest first means carry-forward from last year burns before this year's
 * grant, which is what an employee would choose if asked — the carried days
 * are the ones about to expire.
 *
 * A single day can be split across two buckets, which is the whole reason the
 * junction carries a quantity rather than being a plain link.
 */
export function allocateFifo(
  buckets: readonly (Bucket & { alreadyUsed: number })[],
  days: readonly PlannedDay[],
): { allocations: Allocation[]; shortfall: number } {
  const remaining = buckets
    .filter((b) => b.days - b.alreadyUsed > 0)
    .slice()
    .sort(
      (a, b) =>
        a.fromDate.getTime() - b.fromDate.getTime() ||
        // Same start date: carried days first. They are the ones about to
        // expire, which is what an employee would choose if asked.
        Number(b.carriedForward ?? false) - Number(a.carriedForward ?? false),
    )
    .map((b) => ({ ...b, left: b.days - b.alreadyUsed }));

  const allocations: Allocation[] = [];
  let shortfall = 0;

  days.forEach((day, index) => {
    if (day.lengthDays <= 0) return;
    let needed = day.lengthDays;

    for (const bucket of remaining) {
      if (needed <= 0) break;
      if (bucket.left <= 0) continue;
      // A bucket only funds days inside its own validity window.
      if (day.date < bucket.fromDate || day.date > bucket.toDate) continue;

      const drawn = Math.min(bucket.left, needed);
      bucket.left = round(bucket.left - drawn);
      needed = round(needed - drawn);
      allocations.push({ leaveDayIndex: index, bucketId: bucket.id, lengthDays: drawn });
    }

    if (needed > 0) shortfall = round(shortfall + needed);
  });

  return { allocations, shortfall };
}

// ---------------------------------------------------------------------------
// The five checks before an application is accepted (§6.2)
// ---------------------------------------------------------------------------

/**
 * Fold together consecutive leave years that draw on exactly the same buckets.
 *
 * An ADVANCE type's probation year and first permanent year share one bucket.
 * Checked separately, four days either side of the anniversary would each pass
 * against the same six — eight days out of six. Merged, they are one window
 * with one balance, which is what they are.
 *
 * ponytail: equality, not overlap. Two years sharing some buckets but not all
 * (an HR adjustment made in only one of them) are still checked apart and
 * could over-promise by the shared part. Consumption records the shortfall
 * rather than inventing days, so the ceiling is a discrepancy, not a lie.
 */
export function mergeSharedBalances<T extends { period: LeavePeriod; bucketIds: readonly string[] }>(
  entries: readonly T[],
): T[] {
  const merged: T[] = [];
  for (const entry of entries) {
    const last = merged.at(-1);
    const same =
      last !== undefined &&
      entry.bucketIds.length > 0 &&
      last.bucketIds.length === entry.bucketIds.length &&
      entry.bucketIds.every((id) => last.bucketIds.includes(id));
    if (same) merged[merged.length - 1] = { ...last, period: { from: last.period.from, to: entry.period.to } };
    else merged.push(entry);
  }
  return merged;
}

export type PreflightInput = {
  from: Date;
  to: Date;
  today: Date;
  days: readonly PlannedDay[];
  /**
   * This person's balance in each leave year the range touches, in order. One
   * entry for the ordinary application; two for one that crosses their joining
   * anniversary — unless both years draw on the same bucket, as probation and
   * the first permanent year do, in which case the caller has merged them (see
   * mergeSharedBalances) so the same days are not counted as available twice.
   */
  balances: readonly { period: LeavePeriod; balance: Balance }[];
  overBalance: "REFUSE" | "WARN";
  lateReason: string;
  /** Dates already covered by this person's other live applications. */
  overlappingDates: ReadonlySet<string>;
  attachmentRequiredAfterDays: number | null;
  hasAttachment: boolean;
  /** The longest span the HR Head allows, in calendar days. */
  maximumDays: number;
  /** True for a type that is not counted against a balance — see isUncounted. */
  uncounted: boolean;
  /** How many of this person's team are already away on any of these dates. */
  teamAwayCount: number;
  teamSize: number;
};

export type Preflight = {
  errors: string[];
  warnings: string[];
  ok: boolean;
};

export function preflight(input: PreflightInput): Preflight {
  const errors: string[] = [];
  const warnings: string[] = [];
  const cost = workingDayCost(input.days);

  if (input.to < input.from) {
    errors.push("The last day is before the first day.");
  }

  if (cost === 0) {
    errors.push("Those dates are all weekly offs or public holidays, so there is nothing to apply for.");
  }

  // Checked on the CALENDAR span, before anything walks the dates. An
  // application of a hundred years passed every other check and would have
  // written a day row for each of its 36,525 days.
  const span = Math.round((input.to.getTime() - input.from.getTime()) / 86_400_000) + 1;
  if (input.to >= input.from && span > input.maximumDays) {
    errors.push(
      `That is ${span} days. The longest single application is ${input.maximumDays} — record a longer absence in parts, or ask HR to raise the limit.`,
    );
  }

  // 1 — Are the dates in the future, or is this a late application?
  if (input.from < input.today && !input.lateReason.trim()) {
    errors.push("These dates have already started. Please say why the application is late.");
  }

  // 2 — Enough days of that type left, in each year the leave falls in?
  //
  // Asked leave year by leave year, because an entitlement belongs to its year:
  // days taken after somebody's anniversary come out of the new year's
  // allowance, not out of what was left of the old one. An ordinary
  // application has one year in this list and reads exactly as it always did.
  //
  // Skipped entirely for a type that has no balance to be short of. It used to
  // fall through to the WARN branch and tell somebody applying for one day of
  // unpaid leave that they were "1 more than the balance", which reads as a
  // problem with their application rather than as the definition of the type.
  if (!input.uncounted) {
    for (const { period, balance } of input.balances) {
      const inThatYear = workingDayCost(
        input.days.filter((day) => day.date >= period.from && day.date <= period.to),
      );
      if (inThatYear <= balance.applicable) continue;

      const short = round(inThatYear - balance.applicable);
      const named =
        input.balances.length > 1 ? ` in the leave year from ${formatDate(period.from)}` : "";
      const message =
        `This costs ${inThatYear} day${inThatYear === 1 ? "" : "s"}${named} and you have ${balance.applicable} left` +
        (balance.pending ? ` (${balance.pending} already applied for and waiting)` : "") +
        ` — ${short} more than the balance.`;
      if (input.overBalance === "REFUSE") errors.push(message);
      else warnings.push(`${message} HR allows this type to go over, but it will be noticed.`);
    }
  }

  // 3 — Do these dates overlap an application already made?
  const clash = input.days.find(
    (day) => day.lengthDays > 0 && input.overlappingDates.has(toISODate(day.date)),
  );
  if (clash) {
    errors.push(
      // Written the way the rest of the system writes a date. The ISO form is
      // for the Set lookup above and for URLs, not for a sentence somebody
      // reads.
      `You have already applied for leave on ${formatDate(clash.date)}. Withdraw that one first.`,
    );
  }

  // 4 — Does the type require an attachment?
  const threshold = input.attachmentRequiredAfterDays;
  if (threshold !== null && cost > threshold && !input.hasAttachment) {
    errors.push(
      `Leave of more than ${threshold} day${threshold === 1 ? "" : "s"} of this type needs a medical certificate attached.`,
    );
  }

  // 5 — Are too many of the same team already off on those dates?
  if (input.teamSize > 1 && input.teamAwayCount > 0) {
    const share = input.teamAwayCount / input.teamSize;
    if (share >= 0.5) {
      warnings.push(
        `${input.teamAwayCount} of your ${input.teamSize} colleagues are already away on some of these dates. Your manager may want to know.`,
      );
    }
  }

  return { errors, warnings, ok: errors.length === 0 };
}
