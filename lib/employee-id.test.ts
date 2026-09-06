import { describe, expect, it } from "vitest";
import { advance, formatEmployeeId, parseEmployeeId } from "./employee-id";

describe("§12.1 — the worked example, using FCSL's real numbers", () => {
  // "Your highest existing ID is A 412 - 26 - 70. So:"
  it("the next person to join, in 2026, gets A 413 - 26 - 70", () => {
    expect(formatEmployeeId({ letter: "A", number: 413, year: 2026 })).toBe("A 413 - 26 - 70");
  });

  it("the one after that, also 2026, gets A 414 - 26 - 70", () => {
    expect(formatEmployeeId({ letter: "A", number: 414, year: 2026 })).toBe("A 414 - 26 - 70");
  });

  it("the first person to join in 2027 gets A 415 - 27 - 70 — the number carries on", () => {
    // This is the rule most likely to be got wrong: the running number does
    // NOT reset at the year end. Only the year changes.
    const state = { letter: "A", nextNumber: 415 };
    expect(formatEmployeeId({ letter: state.letter, number: state.nextNumber, year: 2027 })).toBe(
      "A 415 - 27 - 70",
    );
  });

  it("after A 999 comes B 001", () => {
    expect(advance({ letter: "A", nextNumber: 999 })).toEqual({ letter: "B", nextNumber: 1 });
    expect(formatEmployeeId({ letter: "B", number: 1, year: 2027 })).toBe("B 001 - 27 - 70");
  });
});

describe("the format itself", () => {
  it("pads the running number to three digits", () => {
    expect(formatEmployeeId({ letter: "A", number: 7, year: 2026 })).toBe("A 007 - 26 - 70");
    expect(formatEmployeeId({ letter: "A", number: 70, year: 2026 })).toBe("A 070 - 26 - 70");
  });

  it("pads the year to two digits", () => {
    expect(formatEmployeeId({ letter: "C", number: 12, year: 2005 })).toBe("C 012 - 05 - 70");
  });

  it("always ends in 70", () => {
    for (const year of [2019, 2026, 2031]) {
      expect(formatEmployeeId({ letter: "A", number: 1, year })).toMatch(/ - 70$/);
    }
  });
});

describe("the counter never resets and never goes backwards", () => {
  it("increments within a block", () => {
    expect(advance({ letter: "A", nextNumber: 412 })).toEqual({ letter: "A", nextNumber: 413 });
  });

  it("rolls the letter only at 999, not at 1000", () => {
    expect(advance({ letter: "A", nextNumber: 998 })).toEqual({ letter: "A", nextNumber: 999 });
    expect(advance({ letter: "A", nextNumber: 999 })).toEqual({ letter: "B", nextNumber: 1 });
  });

  it("walks the alphabet", () => {
    expect(advance({ letter: "B", nextNumber: 999 })).toEqual({ letter: "C", nextNumber: 1 });
    expect(advance({ letter: "Y", nextNumber: 999 })).toEqual({ letter: "Z", nextNumber: 1 });
  });

  it("refuses to invent a block after Z rather than guessing at AA", () => {
    // 26 blocks of 999 is 25,974 people. If FCSL ever reaches it, somebody has
    // to decide what comes next; an ID nobody has agreed to is worse than an
    // error that stops and says so.
    expect(() => advance({ letter: "Z", nextNumber: 999 })).toThrow(/needs a decision/);
  });
});

describe("parsing", () => {
  it("reads back exactly what it writes, for every shape", () => {
    for (const parts of [
      { letter: "A", number: 413, year: 2026 },
      { letter: "A", number: 1, year: 2019 },
      { letter: "B", number: 999, year: 2031 },
    ]) {
      expect(parseEmployeeId(formatEmployeeId(parts))).toEqual(parts);
    }
  });

  it("forgives whitespace, because these are typed by hand during the import", () => {
    for (const written of ["A413-26-70", "A 413-26-70", "  a 413 -  26 - 70  "]) {
      expect(parseEmployeeId(written)).toEqual({ letter: "A", number: 413, year: 2026 });
    }
  });

  it("rejects a shape that is nearly right, which is the dangerous case", () => {
    expect(parseEmployeeId("A 413 - 26 - 71")).toBeNull(); // suffix is not 70
    expect(parseEmployeeId("A 41 - 26 - 70")).toBeNull(); // two digits, not three
    expect(parseEmployeeId("A 4133 - 26 - 70")).toBeNull(); // four digits
    expect(parseEmployeeId("AA 413 - 26 - 70")).toBeNull(); // two letters
    expect(parseEmployeeId("413 - 26 - 70")).toBeNull(); // no letter
    expect(parseEmployeeId("A 000 - 26 - 70")).toBeNull(); // there is no number 0
    expect(parseEmployeeId("")).toBeNull();
  });

  it("reads two-digit years as this century", () => {
    // 26 is 2026, not 1926. The system will not outlive the ambiguity.
    expect(parseEmployeeId("A 413 - 26 - 70")?.year).toBe(2026);
    expect(parseEmployeeId("A 413 - 05 - 70")?.year).toBe(2005);
  });
});
