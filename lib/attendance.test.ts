import { describe, expect, it } from "vitest";
import { calendarDate, toISODate } from "./dates";
import { canSubmit, isLockedMark, prefillMonth, unfilled } from "./attendance";
import type { AttendanceMark } from "@prisma/client";

const base = { holidays: new Set<string>(), weeklyOffDays: [5, 6], onLeave: new Set<string>() };

describe("§6.3 — what the grid already knows", () => {
  it("pre-fills Fridays and Saturdays as the weekly off", () => {
    const cells = prefillMonth(2026, 9, base);
    const friday = cells.find((c) => toISODate(c.date) === "2026-09-11")!;
    const saturday = cells.find((c) => toISODate(c.date) === "2026-09-12")!;
    expect(friday.mark).toBe("WEEKLY_OFF");
    expect(saturday.mark).toBe("WEEKLY_OFF");
    expect(friday.locked).toBe(true);
  });

  it("pre-fills public holidays", () => {
    const cells = prefillMonth(2026, 9, { ...base, holidays: new Set(["2026-09-16"]) });
    const eid = cells.find((c) => toISODate(c.date) === "2026-09-16")!;
    expect(eid.mark).toBe("PUBLIC_HOLIDAY");
    expect(eid.locked).toBe(true);
  });

  it("pre-fills approved leave", () => {
    const cells = prefillMonth(2026, 9, { ...base, onLeave: new Set(["2026-09-10"]) });
    const away = cells.find((c) => toISODate(c.date) === "2026-09-10")!;
    expect(away.mark).toBe("ON_LEAVE");
    expect(away.locked).toBe(true);
  });

  it("leaves an ordinary working day for the manager to fill", () => {
    const cells = prefillMonth(2026, 9, base);
    const monday = cells.find((c) => toISODate(c.date) === "2026-09-07")!;
    expect(monday.mark).toBeNull();
    expect(monday.locked).toBe(false);
  });

  it("marks nothing the manager may contradict as unlocked", () => {
    const cells = prefillMonth(2026, 9, {
      ...base,
      holidays: new Set(["2026-09-16"]),
      onLeave: new Set(["2026-09-10"]),
    });
    for (const cell of cells) {
      if (cell.mark && isLockedMark(cell.mark)) expect(cell.locked).toBe(true);
      if (!cell.locked) expect(cell.mark).toBeNull();
    }
  });
});

describe("people who were not there all month", () => {
  // Every row keeps one cell per day of the month whatever the dates, because
  // a short row slides left under a shared header and puts one person's
  // Tuesday under somebody else's Friday.
  it("still returns the whole month for a mid-month joiner", () => {
    const cells = prefillMonth(2026, 9, { ...base, from: calendarDate(2026, 9, 15) });
    expect(cells).toHaveLength(30);
    expect(toISODate(cells[0]!.date)).toBe("2026-09-01");
  });

  it("marks the days before they joined as not employed, and locks them", () => {
    const cells = prefillMonth(2026, 9, { ...base, from: calendarDate(2026, 9, 15) });
    const before = cells.filter((c) => !c.employed);
    expect(before).toHaveLength(14);
    expect(before.every((c) => c.locked && c.mark === null)).toBe(true);
    expect(cells.find((c) => toISODate(c.date) === "2026-09-15")!.employed).toBe(true);
  });

  it("marks the days after a leaver's last working day the same way", () => {
    const cells = prefillMonth(2026, 9, { ...base, to: calendarDate(2026, 9, 10) });
    expect(cells).toHaveLength(30);
    expect(cells.find((c) => toISODate(c.date) === "2026-09-10")!.employed).toBe(true);
    expect(cells.find((c) => toISODate(c.date) === "2026-09-11")!.employed).toBe(false);
  });

  it("gives a full row of nothing for somebody who joined after the month ended", () => {
    const cells = prefillMonth(2026, 9, { ...base, from: calendarDate(2026, 11, 1) });
    expect(cells).toHaveLength(30);
    expect(cells.every((c) => !c.employed)).toBe(true);
  });

  it("never asks the manager to fill in a day somebody was not employed", () => {
    const cells = prefillMonth(2026, 9, { ...base, from: calendarDate(2026, 9, 28) });
    // 28th is a Monday; 29th and 30th are working days. Three days employed,
    // and only those can be unfilled.
    expect(unfilled(cells, new Map())).toBe(3);
  });
});

describe("submitting locks the month, so holes must be filled first", () => {
  const cells = prefillMonth(2026, 9, base);
  const workingDays = cells.filter((c) => !c.locked);

  it("counts what is still blank", () => {
    expect(unfilled(cells, new Map())).toBe(workingDays.length);
  });

  it("refuses while anything is blank", () => {
    const partial = new Map<string, AttendanceMark>(
      workingDays.slice(0, 3).map((c) => [toISODate(c.date), "PRESENT" as AttendanceMark]),
    );
    expect(canSubmit(cells, partial)).toBe(false);
  });

  it("allows it once every working day is answered", () => {
    const complete = new Map<string, AttendanceMark>(
      workingDays.map((c) => [toISODate(c.date), "PRESENT" as AttendanceMark]),
    );
    expect(unfilled(cells, complete)).toBe(0);
    expect(canSubmit(cells, complete)).toBe(true);
  });

  it("does not ask the manager to fill in a Friday", () => {
    // Only HR can change a submitted sheet, so a hole left now is a hole
    // locked in — but a weekly off is not a hole.
    const complete = new Map<string, AttendanceMark>(
      workingDays.map((c) => [toISODate(c.date), "PRESENT" as AttendanceMark]),
    );
    expect(canSubmit(cells, complete)).toBe(true);
  });
});
