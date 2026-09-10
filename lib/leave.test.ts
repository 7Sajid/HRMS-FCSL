import { describe, expect, it } from "vitest";
import { addYears, calendarDate, toISODate } from "./dates";
import {
  allocateFifo,
  audienceIncludes,
  carriedForwardDays,
  computeBalance,
  DEFAULT_MAXIMUM_LEAVE_DAYS,
  grantWindow,
  isUncounted,
  leaveYearOf,
  leaveYearsSpanned,
  mergeSharedBalances,
  planLeaveDays,
  preflight,
  probationEnds,
  ruleForPeriod,
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

describe("each person's leave year runs from their joining date (FCSL, 10 Sep 2026)", () => {
  it("runs from the joining date to the day before the anniversary", () => {
    expect(leaveYearOf(d(2026, 6, 1), d(2026, 9, 10))).toEqual({ from: d(2026, 6, 1), to: d(2027, 5, 31) });
  });

  it("starts the next year on the anniversary itself", () => {
    expect(leaveYearOf(d(2026, 6, 1), d(2027, 6, 1))).toEqual({ from: d(2027, 6, 1), to: d(2028, 5, 31) });
    expect(leaveYearOf(d(2026, 6, 1), d(2027, 5, 31))).toEqual({ from: d(2026, 6, 1), to: d(2027, 5, 31) });
  });

  it("keeps a 29 February joiner's years back to back", () => {
    expect(addYears(d(2024, 2, 29), 1)).toEqual(d(2025, 2, 28));
    expect(leaveYearOf(d(2024, 2, 29), d(2024, 12, 1)).to).toEqual(d(2025, 2, 27));
    expect(leaveYearOf(d(2024, 2, 29), d(2025, 3, 1)).from).toEqual(d(2025, 2, 28));
    expect(leaveYearOf(d(2024, 2, 29), d(2028, 3, 1)).from).toEqual(d(2028, 2, 29));
  });

  it("falls back to the calendar year for somebody with no joining date", () => {
    expect(leaveYearOf(null, d(2026, 9, 10))).toEqual({ from: d(2026, 1, 1), to: d(2026, 12, 31) });
  });

  it("names both years an application across the anniversary touches", () => {
    expect(leaveYearsSpanned(d(2026, 6, 1), d(2027, 5, 27), d(2027, 6, 3))).toEqual([
      { from: d(2026, 6, 1), to: d(2027, 5, 31) },
      { from: d(2027, 6, 1), to: d(2028, 5, 31) },
    ]);
    expect(leaveYearsSpanned(d(2026, 6, 1), d(2026, 9, 7), d(2026, 9, 9))).toHaveLength(1);
  });
});

describe("probation (FCSL, 10 Sep 2026)", () => {
  const joined = d(2026, 6, 1);
  const year0 = leaveYearOf(joined, d(2026, 9, 1));
  const year1 = leaveYearOf(joined, d(2027, 9, 1));
  const year2 = leaveYearOf(joined, d(2028, 9, 1));

  it("ends a year after joining, unless HR recorded a confirmation date", () => {
    expect(probationEnds(joined, null)).toEqual(d(2027, 6, 1));
    expect(probationEnds(joined, d(2026, 12, 1))).toEqual(d(2026, 12, 1));
    expect(probationEnds(null, null)).toBeNull();
  });

  it("gives casual and sick leave ONE bucket covering probation and the first permanent year", () => {
    const expected = { from: joined, to: d(2028, 5, 31), rulePeriod: year1 };
    expect(grantWindow("ADVANCE", joined, null, year0)).toEqual(expected);
    expect(grantWindow("ADVANCE", joined, null, year1)).toEqual(expected);
    // "Next year I'll have all 6, 6."
    expect(grantWindow("ADVANCE", joined, null, year2)).toEqual({ ...year2, rulePeriod: year2 });
  });

  it("works FCSL's own example through the arithmetic that already existed", () => {
    // 3 days of casual leave taken in probation...
    const window = grantWindow("ADVANCE", joined, null, year0)!;
    const casual = { id: "casual", fromDate: window.from, toDate: window.to, days: 6, alreadyUsed: 0 };
    const { allocations, shortfall } = allocateFifo(
      [casual],
      planLeaveDays(d(2026, 9, 7), d(2026, 9, 9), new Set()),
    );
    expect(shortfall).toBe(0);
    const used = allocations.reduce((total, a) => total + a.lengthDays, 0);
    expect(used).toBe(3);
    // ...leaves "only 3 casual leave" in the first permanent year: same bucket.
    expect(computeBalance([casual], used, 0).available).toBe(3);
  });

  it("keeps earned leave closed until probation ends", () => {
    expect(grantWindow("AFTER_PROBATION", joined, null, year0)).toBeNull();
    expect(grantWindow("AFTER_PROBATION", joined, null, year1)).toEqual({ ...year1, rulePeriod: year1 });
    // Confirmed early, it opens on the confirmation date and not a day before.
    expect(grantWindow("AFTER_PROBATION", joined, d(2026, 12, 1), year0)).toEqual({
      from: d(2026, 12, 1),
      to: year0.to,
      rulePeriod: year0,
    });
  });

  it("treats an advance for somebody confirmed early as that year's ordinary grant", () => {
    expect(grantWindow("ADVANCE", joined, d(2026, 12, 1), year0)).toEqual({ ...year0, rulePeriod: year0 });
  });

  it("gives an ordinary type its own year from the first day", () => {
    expect(grantWindow("NORMAL", joined, null, year0)).toEqual({ ...year0, rulePeriod: year0 });
  });

  it("grants nothing for a year that ended before they joined", () => {
    expect(grantWindow("NORMAL", joined, null, leaveYearOf(joined, d(2025, 9, 1)))).toBeNull();
  });

  it("checks probation and the first permanent year as one when they share a bucket", () => {
    const none = computeBalance([], 0, 0);
    const merged = mergeSharedBalances([
      { period: year0, bucketIds: ["advance"], balance: none },
      { period: year1, bucketIds: ["advance"], balance: none },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.period).toEqual({ from: year0.from, to: year1.to });

    expect(
      mergeSharedBalances([
        { period: year1, bucketIds: ["a"], balance: none },
        { period: year2, bucketIds: ["b"], balance: none },
      ]),
    ).toHaveLength(2);
  });
});

describe("a leave year's rule", () => {
  const rules = [
    { effectiveFrom: d(2000, 1, 1), daysPerYear: 6 },
    { effectiveFrom: d(2027, 1, 1), daysPerYear: 8 },
  ];

  it("is the one in force on the year's first day, so a change waits for each anniversary", () => {
    expect(ruleForPeriod(rules, { from: d(2026, 6, 1), to: d(2027, 5, 31) })?.daysPerYear).toBe(6);
    expect(ruleForPeriod(rules, { from: d(2027, 6, 1), to: d(2028, 5, 31) })?.daysPerYear).toBe(8);
  });

  it("is a new type's first rule when the type was created part-way through the year", () => {
    const created = [{ effectiveFrom: d(2026, 9, 1), daysPerYear: 3 }];
    expect(ruleForPeriod(created, { from: d(2026, 6, 1), to: d(2027, 5, 31) })?.daysPerYear).toBe(3);
    expect(ruleForPeriod(created, { from: d(2025, 6, 1), to: d(2026, 5, 31) })).toBeNull();
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
        period: { from: d(2026, 1, 1), to: d(2026, 12, 31) },
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
    maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
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
          period: { from: d(2026, 1, 1), to: d(2026, 12, 31) },
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
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
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
    balances: [{ period: { from: d(2026, 1, 1), to: d(2026, 12, 31) }, balance: computeBalance([], 0, 0) }],
    overBalance: "WARN" as const,
    lateReason: "",
    overlappingDates: new Set<string>(),
    attachmentRequiredAfterDays: null,
    hasAttachment: false,
    maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
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

describe("§6.2 — leave that crosses into another leave year", () => {
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
        { period: { from: d(2026, 1, 1), to: d(2026, 12, 31) }, balance: full(2026, 0) },
        { period: { from: d(2027, 1, 1), to: d(2027, 12, 31) }, balance: full(2027, 10) },
      ],
      overBalance: "REFUSE",
      lateReason: "",
      overlappingDates: new Set<string>(),
      attachmentRequiredAfterDays: null,
      hasAttachment: false,
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 5,
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /in the leave year from 01 Jan 2026/.test(e))).toBe(true);
    expect(result.errors.some((e) => /in the leave year from 01 Jan 2027/.test(e))).toBe(false);
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
          period: { from: d(2026, 1, 1), to: d(2026, 12, 31) },
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
      maximumDays: DEFAULT_MAXIMUM_LEAVE_DAYS,
      uncounted: false,
      teamAwayCount: 0,
      teamSize: 5,
    });
    expect(result.ok).toBe(false);
    // The ordinary message, unchanged by the year-by-year rewrite.
    expect(result.errors.some((e) => /more than the balance/.test(e))).toBe(true);
    expect(result.errors.some((e) => /in the leave year from/.test(e))).toBe(false);
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
