import { describe, expect, it } from "vitest";
import { calendarDate, toISODate } from "./dates";
import { accessClosed, CLEARANCE_CHECKLIST, exitBlockers, purgeDateFor } from "./exit";

describe("§6.6 — what stops an exit being finished", () => {
  it("lets a clean exit through", () => {
    expect(exitBlockers({ openTerminals: 0, unclearedItems: 0 })).toEqual([]);
  });

  it("blocks while a trading terminal is still assigned", () => {
    // "The system will not let HR finish an exit while a terminal is still
    // assigned — the single most important safeguard in the module."
    const blockers = exitBlockers({ openTerminals: 1, unclearedItems: 0 });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatch(/terminal is still assigned/);
    expect(blockers[0]).toMatch(/Surrender it/);
  });

  it("counts more than one terminal properly", () => {
    expect(exitBlockers({ openTerminals: 2, unclearedItems: 0 })[0]).toMatch(
      /2 trading terminals are still assigned/,
    );
  });

  it("blocks while clearance is outstanding", () => {
    expect(exitBlockers({ openTerminals: 0, unclearedItems: 3 })[0]).toMatch(
      /3 clearance items are still outstanding/,
    );
  });

  it("names both when both are outstanding", () => {
    expect(exitBlockers({ openTerminals: 1, unclearedItems: 2 })).toHaveLength(2);
  });
});

describe("the clearance checklist", () => {
  it("covers every department the specification names", () => {
    const areas = new Set(CLEARANCE_CHECKLIST.map((item) => item.area));
    // §6.6: "IT equipment, ID card, keys, any outstanding advance from
    // Accounts, handover of client files."
    expect(areas).toContain("IT");
    expect(areas).toContain("ADMIN");
    expect(areas).toContain("ACCOUNTS");
    expect(areas).toContain("CLIENT_HANDOVER");
    expect(areas).toContain("HR");
  });

  it("asks for the client handover, which is the brokerage-specific one", () => {
    expect(CLEARANCE_CHECKLIST.some((i) => /client files/i.test(i.label))).toBe(true);
  });
});

describe("§12.2 — the one-year document rule", () => {
  it("purges one year after the last working day", () => {
    expect(toISODate(purgeDateFor(calendarDate(2026, 4, 30)))).toBe("2027-04-30");
  });

  it("handles a leap day without moving the date sideways", () => {
    expect(toISODate(purgeDateFor(calendarDate(2028, 2, 29)))).toBe("2029-03-01");
  });
});

describe("§6.6 — access closes at the END of the last working day", () => {
  const today = calendarDate(2026, 9, 8);
  const left = (lastWorkingDay: Date | null) => ({ status: "LEFT" as const, lastWorkingDay });

  it("lets somebody still employed in", () => {
    expect(accessClosed({ status: "ACTIVE", lastWorkingDay: null }, today)).toBe(false);
  });

  it("lets them in on the last working day itself — it is a working day", () => {
    expect(accessClosed(left(calendarDate(2026, 9, 8)), today)).toBe(false);
  });

  it("keeps them in while they serve out notice, though the record already says LEFT", () => {
    // This is the ordinary case: HR completes the exit weeks before the day.
    // Reading `status === "LEFT"` alone would lock them out while at work.
    expect(accessClosed(left(calendarDate(2026, 9, 30)), today)).toBe(false);
  });

  it("shuts them out the day after", () => {
    expect(accessClosed(left(calendarDate(2026, 9, 7)), today)).toBe(true);
  });

  it("shuts out somebody marked LEFT with no date to wait for", () => {
    expect(accessClosed(left(null), today)).toBe(true);
  });

  it("has nothing to say about an account with no employee record", () => {
    // The first Super Admin. Never an employee, so never a leaver.
    expect(accessClosed(null, today)).toBe(false);
  });
});
