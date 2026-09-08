import { describe, expect, it } from "vitest";
import { calendarDate, toISODate } from "./dates";
import {
  allocateFifo,
  audienceIncludes,
  carriedForwardDays,
  computeBalance,
  isUncounted,
  planLeaveDays,
  preflight,
  proRatedDays,
  ruleOn,
  weeklyOffOn,
  workingDayCost,
  yearsSpanned,
  type Bucket,
  type PlannedDay,
} from "./leave";

// September 2026: Mon 7 … Thu 10, Fri 11, Sat 12, Sun 13.
const d = calendarDate;

describe("planning the days of an application", () => {
  it("materialises every calendar date, weekends included at zero length", () => {
    const days = planLeaveDays(d(2026, 9, 10), d(2026, 9, 13), new Set());
    expect(days.map((x) => toISODate(x.date))).toEqual([
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
    expect(days.map((x) => x.dayKind)).toEqual(["WORKING", "WEEKLY_OFF", "WEEKLY_OFF", "WORKING"]);
    // Four calendar days, two working days — the number the employee is shown
    // before pressing send.
    expect(workingDayCost(days)).toBe(2);
  });

  it("keeps the dates the employee actually typed", () => {
    // The request shows Thursday to Sunday even though Friday and Saturday
    // cost nothing. Dropping them would make the record disagree with what
    // was asked for.
    const days = planLeaveDays(d(2026, 9, 10), d(2026, 9, 13), new Set());
    expect(days).toHaveLength(4);
  });

  it("charges nothing for a public holiday inside the range", () => {
    const days = planLeaveDays(d(2026, 9, 7), d(2026, 9, 10), new Set(["2026-09-08"]));
    expect(workingDayCost(days)).toBe(3);
    expect(days[1].dayKind).toBe("HOLIDAY");
  });

  it("charges half a day for a half-day holiday", () => {
    const days = planLeaveDays(
      d(2026, 9, 7),
      d(2026, 9, 8),
      new Set(),
      new Set(["2026-09-08"]),
    );
    expect(workingDayCost(days)).toBe(1.5);
  });
});

describe("dated rules keep old records meaning what they meant", () => {
  const rules = [
    { effectiveFrom: d(2000, 1, 1), daysPerYear: 10 },
    { effectiveFrom: d(2026, 1, 1), daysPerYear: 14 },
  ];

  it("uses the rule in force on the date in question", () => {
    expect(ruleOn(rules, d(2025, 6, 1))?.daysPerYear).toBe(10);
    expect(ruleOn(rules, d(2026, 6, 1))?.daysPerYear).toBe(14);
  });

  it("uses the rule that starts exactly today", () => {
    expect(ruleOn(rules, d(2026, 1, 1))?.daysPerYear).toBe(14);
  });

  it("returns nothing for a date before any rule existed", () => {
    expect(ruleOn(rules, d(1999, 1, 1))).toBeNull();
  });

  it("defaults the working week to Friday and Saturday", () => {
    expect(weeklyOffOn([], d(2026, 9, 1))).toEqual([5, 6]);
    expect(weeklyOffOn([{ effectiveFrom: d(2000, 1, 1), days: [5, 6] }], d(2026, 9, 1))).toEqual([5, 6]);
  });
});

describe("a joiner's first year is pro-rated", () => {
  it("gives a full year to somebody who was already here", () => {
    expect(proRatedDays(10, d(2020, 3, 1), 2026)).toBe(10);
  });

  it("gives a January joiner the full year", () => {
    expect(proRatedDays(12, d(2026, 1, 15), 2026)).toBe(12);
  });

  it("gives a July joiner half", () => {
    expect(proRatedDays(12, d(2026, 7, 1), 2026)).toBe(6);
  });

  it("gives a December joiner one month's worth, not a whole year", () => {
    expect(proRatedDays(12, d(2026, 12, 20), 2026)).toBe(1);
  });

  it("rounds to the nearest half day, because leave is taken in half days", () => {
    expect(proRatedDays(10, d(2026, 8, 1), 2026)).toBe(4);
    expect(proRatedDays(14, d(2026, 6, 1), 2026)).toBe(8);
  });

  it("gives nothing for a year before they joined", () => {
    expect(proRatedDays(10, d(2027, 1, 1), 2026)).toBe(0);
  });
});

describe("balances are computed, never counted twice", () => {
  const buckets: Bucket[] = [
    { id: "carry", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 4 },
    { id: "grant", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 10 },
  ];

  it("adds the buckets up", () => {
    expect(computeBalance(buckets, 0, 0).entitled).toBe(14);
  });

  it("takes granted leave off, and shows pending separately", () => {
    const balance = computeBalance(buckets, 3, 2);
    expect(balance.taken).toBe(3);
    // §7.1 rule 3: pending days have NOT left the balance yet.
    expect(balance.available).toBe(11);
    // But they cannot be applied for twice.
    expect(balance.applicable).toBe(9);
  });

  it("does not leak floating point into a sentence somebody reads", () => {
    const half: Bucket[] = [{ id: "a", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 10 }];
    expect(computeBalance(half, 0.1 + 0.2, 0).taken).toBe(0.3);
  });
});

describe("FIFO — carry-forward burns before this year's grant", () => {
  const buckets = [
    { id: "grant", fromDate: d(2026, 4, 1), toDate: d(2026, 12, 31), days: 10, alreadyUsed: 0 },
    { id: "carry", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 2, alreadyUsed: 0 },
  ];

  it("draws from the oldest bucket first, whatever order they arrive in", () => {
    const days = planLeaveDays(d(2026, 9, 7), d(2026, 9, 9), new Set());
    const { allocations, shortfall } = allocateFifo(buckets, days);
    expect(shortfall).toBe(0);
    // Two days from the carried bucket, then the third from the grant.
    expect(allocations.filter((a) => a.bucketId === "carry")).toHaveLength(2);
    expect(allocations.filter((a) => a.bucketId === "grant")).toHaveLength(1);
  });

  it("splits a single half-day across two buckets when one runs out mid-day", () => {
    const nearlyEmpty = [
      { id: "carry", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 0.5, alreadyUsed: 0 },
      { id: "grant", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 10, alreadyUsed: 0 },
    ];
    const oneDay: PlannedDay[] = [{ date: d(2026, 9, 7), dayKind: "WORKING", lengthDays: 1 }];
    const { allocations } = allocateFifo(nearlyEmpty, oneDay);
    // This is the whole reason the junction carries a quantity.
    expect(allocations).toHaveLength(2);
    expect(allocations.map((a) => a.lengthDays)).toEqual([0.5, 0.5]);
    expect(allocations.every((a) => a.leaveDayIndex === 0)).toBe(true);
  });

  it("never funds a day from outside a bucket's validity window", () => {
    const lateBucket = [
      { id: "next-year", fromDate: d(2027, 1, 1), toDate: d(2027, 12, 31), days: 10, alreadyUsed: 0 },
    ];
    const days = planLeaveDays(d(2026, 9, 7), d(2026, 9, 7), new Set());
    const { allocations, shortfall } = allocateFifo(lateBucket, days);
    expect(allocations).toHaveLength(0);
    expect(shortfall).toBe(1);
  });

  it("reports a shortfall rather than over-drawing a bucket", () => {
    const tiny = [{ id: "a", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 1, alreadyUsed: 0 }];
    const days = planLeaveDays(d(2026, 9, 7), d(2026, 9, 9), new Set());
    const { shortfall } = allocateFifo(tiny, days);
    expect(shortfall).toBe(2);
  });

  it("respects what a bucket has already funded", () => {
    const partlySpent = [
      { id: "a", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 10, alreadyUsed: 9 },
    ];
    const days = planLeaveDays(d(2026, 9, 7), d(2026, 9, 9), new Set());
    expect(allocateFifo(partlySpent, days).shortfall).toBe(2);
  });

  it("charges nothing for the weekend inside a range", () => {
    const plenty = [{ id: "a", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 20, alreadyUsed: 0 }];
    const days = planLeaveDays(d(2026, 9, 10), d(2026, 9, 13), new Set());
    const { allocations } = allocateFifo(plenty, days);
    expect(allocations).toHaveLength(2);
  });
});

describe("§6.2 — what the system checks before accepting an application", () => {
  const base = {
    today: d(2026, 9, 1),
    balances: [
      {
        year: 2026,
        balance: computeBalance(
          [{ id: "a", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 10 }],
          0,
          0,
        ),
      },
    ],
    overBalance: "REFUSE" as const,
    lateReason: "",
    overlappingDates: new Set<string>(),
    attachmentRequiredAfterDays: null,
    hasAttachment: false,
    uncounted: false,
    teamAwayCount: 0,
    teamSize: 5,
  };
  const forDates = (from: Date, to: Date) => ({
    ...base,
    from,
    to,
    days: planLeaveDays(from, to, new Set()),
  });

  it("accepts an ordinary application", () => {
    expect(preflight(forDates(d(2026, 9, 7), d(2026, 9, 9))).ok).toBe(true);
  });

  it("1 — asks why a backdated application is late", () => {
    const late = preflight(forDates(d(2026, 8, 20), d(2026, 8, 21)));
    expect(late.ok).toBe(false);
    expect(late.errors.some((e) => /why the application is late/.test(e))).toBe(true);

    const explained = preflight({ ...forDates(d(2026, 8, 20), d(2026, 8, 21)), lateReason: "I was in hospital." });
    expect(explained.ok).toBe(true);
  });

  it("2 — refuses more days than the balance, and says by how many", () => {
    const tooMuch = preflight(forDates(d(2026, 9, 1), d(2026, 9, 30)));
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.errors.some((e) => /more than the balance/.test(e))).toBe(true);
  });

  it("2 — counts days already applied for and waiting", () => {
    const withPending = preflight({
      ...forDates(d(2026, 9, 7), d(2026, 9, 11)),
      balances: [
        {
          year: 2026,
          balance: computeBalance(
            [{ id: "a", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 10 }],
            0,
            8,
          ),
        },
      ],
    });
    expect(withPending.ok).toBe(false);
    expect(withPending.errors.some((e) => /already applied for and waiting/.test(e))).toBe(true);
  });

  it("2 — warns rather than refuses when HR allows the type to go over", () => {
    const warned = preflight({ ...forDates(d(2026, 9, 1), d(2026, 9, 30)), overBalance: "WARN" });
    expect(warned.ok).toBe(true);
    expect(warned.warnings.some((w) => /go over/.test(w))).toBe(true);
  });

  it("3 — refuses dates that overlap an application already made", () => {
    const clash = preflight({
      ...forDates(d(2026, 9, 7), d(2026, 9, 9)),
      overlappingDates: new Set(["2026-09-08"]),
    });
    expect(clash.ok).toBe(false);
    // Written the way every other date in the system is written. The ISO form
    // is what the Set is keyed on, not what a person should be shown.
    expect(clash.errors.some((e) => /already applied for leave on 08 Sept 2026/.test(e))).toBe(true);
    expect(clash.errors.some((e) => /2026-09-08/.test(e))).toBe(false);
  });

  it("3 — ignores an overlap that falls on a weekend, which costs nothing", () => {
    const weekendClash = preflight({
      ...forDates(d(2026, 9, 10), d(2026, 9, 13)),
      overlappingDates: new Set(["2026-09-11"]),
    });
    expect(weekendClash.ok).toBe(true);
  });

  it("4 — demands a medical certificate past the threshold", () => {
    const noCert = preflight({
      ...forDates(d(2026, 9, 7), d(2026, 9, 11)),
      attachmentRequiredAfterDays: 3,
    });
    expect(noCert.ok).toBe(false);
    expect(noCert.errors.some((e) => /medical certificate/.test(e))).toBe(true);

    const withCert = preflight({
      ...forDates(d(2026, 9, 7), d(2026, 9, 11)),
      attachmentRequiredAfterDays: 3,
      hasAttachment: true,
    });
    expect(withCert.ok).toBe(true);
  });

  it("4 — does not demand one below the threshold", () => {
    const short = preflight({
      ...forDates(d(2026, 9, 7), d(2026, 9, 8)),
      attachmentRequiredAfterDays: 3,
    });
    expect(short.ok).toBe(true);
  });

  it("5 — warns, but does not refuse, when half the team is already away", () => {
    const thin = preflight({ ...forDates(d(2026, 9, 7), d(2026, 9, 9)), teamAwayCount: 3, teamSize: 5 });
    // A warning, because whether the branch can spare them is the manager's
    // judgement and not the software's.
    expect(thin.ok).toBe(true);
    expect(thin.warnings.some((w) => /already away/.test(w))).toBe(true);
  });

  it("refuses a range that is entirely weekend", () => {
    const nothing = preflight(forDates(d(2026, 9, 11), d(2026, 9, 12)));
    expect(nothing.ok).toBe(false);
    expect(nothing.errors.some((e) => /nothing to apply for/.test(e))).toBe(true);
  });

  it("refuses a backwards range", () => {
    const backwards = preflight(forDates(d(2026, 9, 9), d(2026, 9, 7)));
    expect(backwards.ok).toBe(false);
  });
});

describe("a type with no entitlement is not a balance (§6.2)", () => {
  const unpaid = {
    today: d(2026, 9, 1),
    balances: [{ year: 2026, balance: computeBalance([], 0, 0) }],
    overBalance: "WARN" as const,
    lateReason: "",
    overlappingDates: new Set<string>(),
    attachmentRequiredAfterDays: null,
    hasAttachment: false,
    uncounted: true,
    teamAwayCount: 0,
    teamSize: 5,
  };

  it("recognises leave without pay from its rule, not from its code", () => {
    // §12: leave types are the HR Head's to configure and are never hardcoded.
    expect(isUncounted(0, "WARN")).toBe(true);
    // Earned leave that somebody has fully used is NOT uncounted — it has an
    // entitlement, it is simply spent.
    expect(isUncounted(20, "WARN")).toBe(false);
    // Nought days that may NOT be exceeded is a type nobody can take at all,
    // which is a different thing and still refuses.
    expect(isUncounted(0, "REFUSE")).toBe(false);
  });

  it("says nothing about being short of a balance that does not exist", () => {
    const from = d(2026, 9, 7);
    const to = d(2026, 9, 7);
    const result = preflight({
      ...unpaid,
      from,
      to,
      days: planLeaveDays(from, to, new Set()),
    });
    expect(result.ok).toBe(true);
    const said = [...result.errors, ...result.warnings].join(" ");
    expect(said).not.toMatch(/more than the balance/);
    expect(said).not.toMatch(/-1/);
  });

  it("still refuses a counted type that is genuinely over", () => {
    const from = d(2026, 9, 7);
    const to = d(2026, 9, 25);
    const result = preflight({
      ...unpaid,
      uncounted: false,
      overBalance: "REFUSE" as const,
      from,
      to,
      days: planLeaveDays(from, to, new Set()),
    });
    expect(result.ok).toBe(false);
  });
});

describe("who a leave type is offered to (§6.2)", () => {
  it("gives everybody a type marked for everybody", () => {
    expect(audienceIncludes("ALL", "Male")).toBe(true);
    expect(audienceIncludes("ALL", "")).toBe(true);
  });

  it("keeps maternity leave off a man's dropdown", () => {
    expect(audienceIncludes("FEMALE", "Male")).toBe(false);
    expect(audienceIncludes("FEMALE", "male")).toBe(false);
    expect(audienceIncludes("FEMALE", "M")).toBe(false);
  });

  it("offers it to a woman however HR typed it", () => {
    for (const written of ["Female", "female", "F", "woman"]) {
      expect(audienceIncludes("FEMALE", written)).toBe(true);
    }
  });

  it("offers it when gender is not recorded", () => {
    // Deliberate and asymmetric: denying a statutory entitlement over a blank
    // field is a real harm, offering one over a blank field is an
    // embarrassment. They are not the same size.
    expect(audienceIncludes("FEMALE", "")).toBe(true);
    expect(audienceIncludes("FEMALE", "   ")).toBe(true);
    expect(audienceIncludes("FEMALE", "Prefer not to say")).toBe(true);
  });

  it("shows every type rather than none when the value is not one it knows", () => {
    // A leave page with no leave types on it is a person who cannot apply.
    expect(audienceIncludes(undefined, "Male")).toBe(true);
    expect(audienceIncludes(null, "Male")).toBe(true);
  });
});

describe("§6.2 — leave that crosses New Year", () => {
  it("knows both years a Christmas week touches", () => {
    expect(yearsSpanned(d(2026, 12, 28), d(2027, 1, 4))).toEqual([2026, 2027]);
    expect(yearsSpanned(d(2026, 9, 7), d(2026, 9, 11))).toEqual([2026]);
  });

  it("checks each year against its own balance", () => {
    const from = d(2026, 12, 28);
    const to = d(2027, 1, 8);
    const full = (year: number, days: number) =>
      computeBalance([{ id: String(year), fromDate: d(year, 1, 1), toDate: d(year, 12, 31), days }], 0, 0);

    // Nothing left in 2026, plenty in 2027. The December days are the problem
    // and the message has to say which year it is talking about.
    const result = preflight({
      from,
      to,
      today: d(2026, 12, 1),
      days: planLeaveDays(from, to, new Set()),
      balances: [
        { year: 2026, balance: full(2026, 0) },
        { year: 2027, balance: full(2027, 10) },
      ],
      overBalance: "REFUSE",
      lateReason: "",
      overlappingDates: new Set<string>(),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 5,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /in 2026/.test(e))).toBe(true);
    expect(result.errors.some((e) => /in 2027/.test(e))).toBe(false);
  });

  it("says nothing about the year when there is only one", () => {
    const from = d(2026, 9, 7);
    const to = d(2026, 9, 25);
    const result = preflight({
      from,
      to,
      today: d(2026, 9, 1),
      days: planLeaveDays(from, to, new Set()),
      balances: [
        {
          year: 2026,
          balance: computeBalance(
            [{ id: "a", fromDate: d(2026, 1, 1), toDate: d(2026, 12, 31), days: 10 }],
            0,
            0,
          ),
        },
      ],
      overBalance: "REFUSE",
      lateReason: "",
      overlappingDates: new Set<string>(),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 5,
    });
    expect(result.ok).toBe(false);
    // The ordinary message, unchanged by the year-by-year rewrite.
    expect(result.errors.some((e) => /more than the balance/.test(e))).toBe(true);
    expect(result.errors.some((e) => / in 20\d\d /.test(e))).toBe(false);
  });
});

describe("§12.2 — carrying leave into next year", () => {
  it("carries what was not used, up to the cap", () => {
    expect(carriedForwardDays(20, 5, 40)).toBe(15);
    expect(carriedForwardDays(20, 0, 10)).toBe(10);
  });

  it("carries nothing when it was all taken, and never a negative", () => {
    expect(carriedForwardDays(20, 20, 40)).toBe(0);
    // A shortfall — granted more than they had — must not carry a debt.
    expect(carriedForwardDays(20, 25, 40)).toBe(0);
  });

  it("carries everything when there is no cap", () => {
    expect(carriedForwardDays(20, 5, null)).toBe(15);
  });

  it("draws carried days before this year's grant", () => {
    // Both open on 1 January, so a sort on the date alone cannot separate
    // them — and the carried ones are the ones that lapse.
    const carried = { id: "carried", fromDate: d(2027, 1, 1), toDate: d(2027, 12, 31), days: 5, carriedForward: true, alreadyUsed: 0 };
    const granted = { id: "granted", fromDate: d(2027, 1, 1), toDate: d(2027, 12, 31), days: 20, carriedForward: false, alreadyUsed: 0 };
    const { allocations } = allocateFifo(
      [granted, carried],
      planLeaveDays(d(2027, 3, 1), d(2027, 3, 3), new Set()),
    );
    expect(allocations.length).toBeGreaterThan(0);
    expect(allocations.every((a) => a.bucketId === "carried")).toBe(true);
  });
});
