import { describe, expect, it } from "vitest";
import { calendarDate } from "./dates";
import { certificateStatus, expiringWithinMonths, warningStarts } from "./certificate";

const d = calendarDate;
const today = d(2026, 9, 6);

describe("§5.1 — the countdown in plain words", () => {
  it("prints the sentence the specification prints", () => {
    // "Valid. Expires 14 March 2027 — 6 months and 11 days remaining."
    const status = certificateStatus({ expiryDate: d(2027, 3, 17) }, today);
    expect(status.sentence).toBe("Valid. Expires 17 March 2027 — 6 months and 11 days remaining.");
    expect(status.label).toBe("Valid");
    expect(status.tone).toBe("success");
  });
});

describe("the four-month warning", () => {
  it("is green with more than four months to run", () => {
    const status = certificateStatus({ expiryDate: d(2027, 3, 1) }, today);
    expect(status.state).toBe("VALID");
    expect(status.tone).toBe("success");
  });

  it("turns amber the day the four months begin, not a day early", () => {
    // Four months before 6 January 2027 is 6 September 2026 — today.
    const onTheDay = certificateStatus({ expiryDate: d(2027, 1, 6) }, today);
    expect(onTheDay.state).toBe("RENEWAL_DUE");
    expect(onTheDay.label).toBe("Renewal due");
    expect(onTheDay.tone).toBe("warn");

    const dayBefore = certificateStatus({ expiryDate: d(2027, 1, 7) }, today);
    expect(dayBefore.state).toBe("VALID");
  });

  it("counts four calendar months, not 120 days", () => {
    expect(warningStarts(d(2027, 3, 14))).toEqual(d(2026, 11, 14));
    expect(warningStarts(d(2027, 1, 31))).toEqual(d(2026, 9, 31));
  });

  it("stays amber right up to the expiry date itself", () => {
    const lastDay = certificateStatus({ expiryDate: today }, today);
    expect(lastDay.state).toBe("RENEWAL_DUE");
  });

  it("turns red the day after expiry", () => {
    const status = certificateStatus({ expiryDate: d(2026, 9, 5) }, today);
    expect(status.state).toBe("EXPIRED");
    expect(status.label).toBe("Expired");
    expect(status.tone).toBe("danger");
    expect(status.sentence).toContain("HR has been told");
  });
});

describe("what it never does", () => {
  it("has no notion of blocking anybody", () => {
    // §12.2: "the system never blocks the person or their work, whatever the
    // certificate status." There is deliberately no field here that could be
    // read as permission to stop somebody working.
    const expired = certificateStatus({ expiryDate: d(2020, 1, 1) }, today);
    expect(Object.keys(expired)).toEqual([
      "state",
      "label",
      "tone",
      "sentence",
      "daysRemaining",
    ]);
    expect(JSON.stringify(expired)).not.toMatch(/block|suspend|deny|revoke/i);
  });

  it("does not hide an expired certificate", () => {
    const expired = certificateStatus({ expiryDate: d(2026, 1, 1) }, today);
    expect(expired.sentence).not.toBe("");
    expect(expired.daysRemaining).toBeLessThan(0);
  });
});

describe("the states that are not a countdown", () => {
  it("says so plainly when nothing is on file", () => {
    const none = certificateStatus(null, today);
    expect(none.state).toBe("NONE");
    expect(none.tone).toBe("neutral");
  });

  it("stops counting once surrendered", () => {
    // §6.6: on exit the certificate is surrendered and the person drops out
    // of the expiry register.
    const gone = certificateStatus({ expiryDate: d(2027, 3, 14), status: "SURRENDERED" }, today);
    expect(gone.state).toBe("SURRENDERED");
    expect(gone.daysRemaining).toBeNull();
  });
});

describe("§6.10 — how many expire in the next three, six and twelve months", () => {
  it("counts one inside the window", () => {
    expect(expiringWithinMonths(d(2026, 11, 1), 3, today)).toBe(true);
    expect(expiringWithinMonths(d(2027, 6, 1), 3, today)).toBe(false);
    expect(expiringWithinMonths(d(2027, 6, 1), 12, today)).toBe(true);
  });

  it("does not count one that has already expired", () => {
    // An expired certificate is a different report line, and counting it as
    // "expiring soon" would hide it in a number instead of showing it in red.
    expect(expiringWithinMonths(d(2026, 1, 1), 12, today)).toBe(false);
  });
});
