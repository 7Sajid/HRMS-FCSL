import type { LeaveDayKind } from "@prisma/client";
import { calendarDate, dayKind, eachDate, toISODate, type HolidaySet } from "./dates";

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
  if (cost > input.balance.applicable) {
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
      `You have already applied for leave on ${toISODate(clash.date)}. Withdraw that one first.`,
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
