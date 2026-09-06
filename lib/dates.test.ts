import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  calendarDate,
  dayKind,
  daysInMonth,
  dhakaDateOnly,
  dhakaRange,
  eachDate,
  formatDate,
  formatDateTime,
  fromISODate,
  humanDaysUntil,
  toISODate,
  workingDaysBetween,
  workingDaysSince,
} from "./dates";

// September 2026 for reference:
//   Mon 7  Tue 8  Wed 9  Thu 10  Fri 11  Sat 12  Sun 13
// Friday and Saturday are the weekly off (§12.2).

describe("formatting is always Dhaka, never the server's zone", () => {
  it("formats a calendar date as the document writes it", () => {
    expect(formatDate(calendarDate(2026, 8, 9))).toBe("09 Aug 2026");
    expect(formatDate(calendarDate(2027, 3, 14))).toBe("14 Mar 2027");
  });

  it("shows the Dhaka day for an instant, not the UTC day", () => {
    // 20:30 UTC on 8 August is 02:30 on 9 August in Dhaka. A server rendering
    // this in UTC would print the wrong date for six hours out of every day —
    // on leave dates and certificate expiries, which are what people argue
    // about.
    expect(formatDateTime(new Date("2026-08-08T20:30:00Z"))).toBe("09 Aug 2026, 02:30");
    // ...and the boundary itself: 17:59 UTC is still the 8th in Dhaka.
    expect(formatDate(new Date("2026-08-08T17:59:00Z"))).toBe("08 Aug 2026");
    expect(formatDate(new Date("2026-08-08T18:00:00Z"))).toBe("09 Aug 2026");
  });

  it("prints an em dash rather than 'Invalid Date' for missing values", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });

  it("reduces an instant to the Dhaka calendar date it fell on", () => {
    expect(toISODate(dhakaDateOnly(new Date("2026-08-08T20:30:00Z")))).toBe("2026-08-09");
    expect(toISODate(dhakaDateOnly(new Date("2026-08-08T17:00:00Z")))).toBe("2026-08-08");
  });
});

describe("parsing refuses to invent dates", () => {
  it("reads an ISO date", () => {
    expect(toISODate(fromISODate("2026-09-06")!)).toBe("2026-09-06");
  });

  it("returns null instead of an Invalid Date, which poisons every comparison", () => {
    expect(fromISODate("")).toBeNull();
    expect(fromISODate(null)).toBeNull();
    expect(fromISODate("06/09/2026")).toBeNull();
    expect(fromISODate("2026-9-6")).toBeNull();
  });

  it("refuses a day that does not exist rather than rolling it into next month", () => {
    // `new Date("2026-02-31")` is 3 March. A joining date of 31 February must
    // be an error the importer reports, not a date it silently invents.
    expect(fromISODate("2026-02-31")).toBeNull();
    expect(fromISODate("2026-13-01")).toBeNull();
  });
});

describe("working days — Friday and Saturday are the weekly off", () => {
  it("counts four calendar days spanning the weekend as two working days", () => {
    // Thursday 10 to Sunday 13 September 2026. This is the example the
    // employee sees before pressing send, and it has to match what the
    // approver and the balance later agree.
    expect(workingDaysBetween(calendarDate(2026, 9, 10), calendarDate(2026, 9, 13))).toBe(2);
  });

  it("counts a full Sunday-to-Thursday week as five", () => {
    expect(workingDaysBetween(calendarDate(2026, 9, 6), calendarDate(2026, 9, 10))).toBe(5);
  });

  it("counts a leave that is only the weekend as zero", () => {
    expect(workingDaysBetween(calendarDate(2026, 9, 11), calendarDate(2026, 9, 12))).toBe(0);
  });

  it("excludes public holidays as well", () => {
    const holidays = new Set(["2026-09-08", "2026-09-09"]);
    expect(workingDaysBetween(calendarDate(2026, 9, 6), calendarDate(2026, 9, 10), holidays)).toBe(3);
  });

  it("counts a single working day as one", () => {
    expect(workingDaysBetween(calendarDate(2026, 9, 7), calendarDate(2026, 9, 7))).toBe(1);
  });

  it("returns zero for a backwards range rather than a negative count", () => {
    expect(workingDaysBetween(calendarDate(2026, 9, 10), calendarDate(2026, 9, 6))).toBe(0);
  });
});

describe("dayKind — what the attendance grid pre-fills", () => {
  it("marks Friday and Saturday as the weekly off", () => {
    expect(dayKind(calendarDate(2026, 9, 11))).toBe("WEEKLY_OFF");
    expect(dayKind(calendarDate(2026, 9, 12))).toBe("WEEKLY_OFF");
  });

  it("marks a working day as working", () => {
    expect(dayKind(calendarDate(2026, 9, 10))).toBe("WORKING");
  });

  it("marks a public holiday", () => {
    expect(dayKind(calendarDate(2026, 9, 10), new Set(["2026-09-10"]))).toBe("HOLIDAY");
  });

  it("prefers 'weekly off' when a holiday falls on a Friday", () => {
    // Both are non-working and both cost zero, so the choice only affects what
    // the grid prints — and a person looking at a Friday expects to read
    // "Weekly off", not to be told Eid fell on a day they were not working.
    expect(dayKind(calendarDate(2026, 9, 11), new Set(["2026-09-11"]))).toBe("WEEKLY_OFF");
  });
});

describe("addWorkingDays — the reminder and escalation deadlines", () => {
  it("does not make a Thursday request overdue on Sunday", () => {
    // §7.3: amber after three working days. Raised Thursday 10 September, the
    // three working days are Sun 13, Mon 14, Tue 15 — not Fri, Sat, Sun.
    expect(toISODate(addWorkingDays(calendarDate(2026, 9, 10), 3))).toBe("2026-09-15");
  });

  it("skips holidays too", () => {
    const holidays = new Set(["2026-09-14"]);
    expect(toISODate(addWorkingDays(calendarDate(2026, 9, 10), 3, holidays))).toBe("2026-09-16");
  });

  it("returns the starting date when asked for zero", () => {
    expect(toISODate(addWorkingDays(calendarDate(2026, 9, 10), 0))).toBe("2026-09-10");
  });

  it("terminates rather than spinning if every day is somehow non-working", () => {
    // A holiday table that marked everything would otherwise hang a server
    // render. Bounded at ten years.
    const everyDay = new Set(eachDate(calendarDate(2026, 1, 1), calendarDate(2036, 12, 31)).map(toISODate));
    expect(() => addWorkingDays(calendarDate(2026, 9, 10), 3, everyDay)).not.toThrow();
  });
});

describe("workingDaysSince — how long a request has been waiting", () => {
  it("counts working days elapsed, excluding the day it was raised", () => {
    expect(workingDaysSince(calendarDate(2026, 9, 10), new Set(), [5, 6], calendarDate(2026, 9, 15))).toBe(3);
  });

  it("is zero on the day itself", () => {
    expect(workingDaysSince(calendarDate(2026, 9, 10), new Set(), [5, 6], calendarDate(2026, 9, 10))).toBe(0);
  });

  it("is zero across a weekend alone", () => {
    expect(workingDaysSince(calendarDate(2026, 9, 10), new Set(), [5, 6], calendarDate(2026, 9, 12))).toBe(0);
  });
});

describe("humanDaysUntil — the certificate countdown in plain words", () => {
  const today = calendarDate(2026, 9, 6);

  it("reads as §5.1 writes it", () => {
    // "Valid. Expires 14 March 2027 — 6 months and 11 days remaining."
    expect(humanDaysUntil(calendarDate(2027, 3, 17), today)).toBe("6 months and 11 days");
  });

  it("uses days alone for anything under a month", () => {
    expect(humanDaysUntil(calendarDate(2026, 9, 23), today)).toBe("17 days");
    expect(humanDaysUntil(calendarDate(2026, 9, 7), today)).toBe("1 day");
  });

  it("says 'today' on the day itself", () => {
    expect(humanDaysUntil(today, today)).toBe("today");
  });

  it("counts calendar months, so the four-month warning means what it says", () => {
    expect(humanDaysUntil(calendarDate(2027, 1, 6), today)).toBe("4 months");
  });

  it("handles a date already past without printing a negative", () => {
    expect(humanDaysUntil(calendarDate(2026, 8, 20), today)).toBe("17 days");
  });
});

describe("query ranges", () => {
  it("covers a Dhaka day as a half-open instant range", () => {
    const { gte, lt } = dhakaRange(calendarDate(2026, 9, 6), calendarDate(2026, 9, 6));
    // Midnight in Dhaka is 18:00 UTC the previous day.
    expect(gte.toISOString()).toBe("2026-09-05T18:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-09-06T18:00:00.000Z");
  });
});

describe("calendar helpers", () => {
  it("knows the length of a month, including February in a leap year", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("lists every date in a range, both ends included", () => {
    const days = eachDate(calendarDate(2026, 9, 10), calendarDate(2026, 9, 13));
    expect(days.map(toISODate)).toEqual(["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  });

  it("crosses a month boundary without drifting", () => {
    const days = eachDate(calendarDate(2026, 9, 29), calendarDate(2026, 10, 2));
    expect(days.map(toISODate)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});
