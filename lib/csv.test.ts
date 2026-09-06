import { describe, expect, it } from "vitest";
import { exportFileName, toCsv } from "./csv";

describe("CSV export", () => {
  it("starts with a BOM so Excel does not mangle Bangla names", () => {
    const csv = toCsv(["Name"], [["রহিম উদ্দিন"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("রহিম উদ্দিন");
  });

  it("quotes every cell, so a comma in a name is not a new column", () => {
    expect(toCsv(["Name"], [["Uddin, Rahim"]])).toContain('"Uddin, Rahim"');
  });

  it("escapes an embedded quote by doubling it", () => {
    expect(toCsv(["Note"], [['He said "no"']])).toContain('"He said ""no"""');
  });

  it("neutralises a cell Excel would run as a formula", () => {
    // An employee note beginning with = becomes code on the machine of
    // whoever opens the export.
    const csv = toCsv(["Note"], [["=HYPERLINK(\"http://evil\",\"click\")"]]);
    expect(csv).toContain('"\t=HYPERLINK');
    // ...and the same for the other three lead characters.
    for (const lead of ["+", "-", "@"]) {
      expect(toCsv(["N"], [[`${lead}cmd`]])).toContain(`"\t${lead}cmd"`);
    }
  });

  it("leaves an ordinary value alone", () => {
    expect(toCsv(["ID"], [["A 413 - 26 - 70"]])).toContain('"A 413 - 26 - 70"');
    // The hyphen is mid-string, not leading, so nothing is prefixed.
    expect(toCsv(["ID"], [["A 413 - 26 - 70"]])).not.toContain('"\tA 413');
  });

  it("uses CRLF, because Excel on Windows puts an LF-only file on one row", () => {
    expect(toCsv(["A", "B"], [[1, 2]])).toBe('﻿"A","B"\r\n"1","2"\r\n');
  });

  it("writes an empty cell for null and undefined rather than the word", () => {
    expect(toCsv(["A"], [[null]])).toContain('""');
    expect(toCsv(["A"], [[undefined]])).not.toContain("undefined");
  });

  it("names the file with the date it was taken", () => {
    expect(exportFileName("employees", new Date("2026-09-06T10:00:00Z"))).toBe(
      "fcsl-employees-2026-09-06.csv",
    );
  });
});
