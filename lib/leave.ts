import type { LeaveDayKind } from "@prisma/client";
import { calendarDate, dayKind, eachDate, formatDate, toISODate, type HolidaySet } from "./dates";

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
// Calendar year. The specification does not name one, and the Labour Act's
// entitlements are annual figures, so January to December is the reading that
// needs no further assumption. If FCSL runs a July year this is the one place
// it changes — and LeaveTypeRule is already dated so old records keep their
// meaning.
// ---------------------------------------------------------------------------

export function leaveYearBounds(year: number): { from: Date; to: Date } {
  return { from: calendarDate(year, 1, 1), to: calendarDate(year, 12, 31) };
}

/**
 * A joiner's first year, pro-rated by the months they are actually employed.
 *
 * NOT stated in the specification — it is a policy question. Pro-rating is the
 * ordinary practice and the conservative direction: HR can always add days to
 * a bucket, and an adjustment is visible in the register, whereas a December
 * joiner silently holding a full year of casual leave is not.
 */
export function proRatedDays(annualDays: number, joiningDate: Date | null, year: number): number {
  if (!annualDays) return 0;
  if (!joiningDate || joiningDate.getUTCFullYear() < year) return annualDays;
  if (joiningDate.getUTCFullYear() > year) return 0;
  const monthsEmployed = 12 - joiningDate.getUTCMonth();
  // To the nearest half day: leave is taken in half days, so a third of a day
  // is a number nobody can act on.
  return Math.round((annualDays * monthsEmployed) / 12 * 2) / 2;
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

export type Bucket = { id: string; fromDate: Date; toDate: Date; days: number };

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
    .sort((a, b) => a.fromDate.getTime() - b.fromDate.getTime())
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

export type PreflightInput = {
  from: Date;
  to: Date;
  today: Date;
  days: readonly PlannedDay[];
  balance: Balance;
  overBalance: "REFUSE" | "WARN";
  lateReason: string;
  /** Dates already covered by this person's other live applications. */
  overlappingDates: ReadonlySet<string>;
  attachmentRequiredAfterDays: number | null;
  hasAttachment: boolean;
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

  // 1 — Are the dates in the future, or is this a late application?
  if (input.from < input.today && !input.lateReason.trim()) {
    errors.push("These dates have already started. Please say why the application is late.");
  }

  // 2 — Enough days of that type left?
  //
  // Skipped entirely for a type that has no balance to be short of. It used to
  // fall through to the WARN branch and tell somebody applying for one day of
  // unpaid leave that they were "1 more than the balance", which reads as a
  // problem with their application rather than as the definition of the type.
  if (!input.uncounted && cost > input.balance.applicable) {
    const short = round(cost - input.balance.applicable);
    const message =
      `This costs ${cost} day${cost === 1 ? "" : "s"} and you have ${input.balance.applicable} left` +
      (input.balance.pending
        ? ` (${input.balance.pending} already applied for and waiting)`
        : "") +
      ` — ${short} more than the balance.`;
    if (input.overBalance === "REFUSE") errors.push(message);
    else warnings.push(`${message} HR allows this type to go over, but it will be noticed.`);
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
