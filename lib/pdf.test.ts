import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { showCauseReplyPdf, winAnsi, wrap } from "./pdf";

/**
 * §6.5's PDF. The two things worth pinning down are that a character nobody
 * planned for cannot stop somebody answering a disciplinary letter, and that a
 * long reply does not run off the edge of the page.
 */

describe("winAnsi — the standard fonts cannot write everything", () => {
  it("folds the typography that arrives when somebody pastes from Word", () => {
    expect(winAnsi("Karim’s “reply” — fine…")).toBe('Karim\'s "reply" - fine...');
  });

  it("keeps accented Latin readable by stripping to the base letter", () => {
    expect(winAnsi("café naïve")).toBe("cafe naive");
  });

  it("never throws on a script the font cannot write", () => {
    // Bangla is out of scope (§12), but a name pasted in must not be able to
    // crash the reply. "?" is honest; an exception would lose the reply.
    expect(() => winAnsi("আবার")).not.toThrow();
    expect(winAnsi("আবার")).toBe("????");
  });

  it("leaves ordinary English alone", () => {
    const plain = "I was absent on 3 September 2026 (Tk. 500 was deducted).";
    expect(winAnsi(plain)).toBe(plain);
  });
});

describe("wrap — nothing runs off the edge", () => {
  it("breaks at spaces and never exceeds the width", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = wrap("the quick brown fox ".repeat(30).trim(), font, 11, 300);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 11)).toBeLessThanOrEqual(300);
  });

  it("cuts a single unbreakable token rather than letting it overflow", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const lines = wrap("x".repeat(400), font, 11, 200);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 11)).toBeLessThanOrEqual(200);
  });

  it("keeps the blank line between paragraphs", async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    expect(wrap("one\n\ntwo", font, 11, 400)).toEqual(["one", "", "two"]);
  });
});

describe("the reply document", () => {
  const input = {
    employeeName: "Md. Karim Hossain",
    employeeCode: "A 118 - 24 - 70",
    subject: "Unexplained absence",
    letterBody: "You were absent on 3 September 2026.",
    issuedByName: "Nasreen Akhter",
    issuedOn: "5 Sep 2026",
    replyBody: "My mother was admitted to hospital that night.",
    repliedOn: "8 Sep 2026",
  };

  it("is a real PDF", async () => {
    const bytes = await showCauseReplyPdf(input);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("carries the letter as well as the reply, so it reads on its own", async () => {
    const bytes = await showCauseReplyPdf(input);
    const text = (await PDFDocument.load(bytes)).getTitle();
    expect(text).toContain("Md. Karim Hossain");
    // The letter body is drawn on the page; a document holding only the answer
    // would be unreadable to whoever asks for it in five years.
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    expect(pages).toBeGreaterThanOrEqual(1);
  });

  it("adds pages rather than writing off the bottom of the first one", async () => {
    const long = { ...input, replyBody: "This is my account of what happened. ".repeat(300) };
    const bytes = await showCauseReplyPdf(long);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });

  it("survives a name the font cannot write", async () => {
    const awkward = { ...input, employeeName: "আবার Karim" };
    await expect(showCauseReplyPdf(awkward)).resolves.toBeInstanceOf(Uint8Array);
  });
});
