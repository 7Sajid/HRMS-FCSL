import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * §6.5 — "they reply inside the system and the reply is turned into a PDF
 * automatically."
 *
 * A disciplinary reply is a document a lawyer or a BSEC inspector may one day
 * ask for, so it has to be a file that reads on its own — which means it
 * carries the letter it answers, not only the answer. Text in the database is
 * a record; a page somebody can hand over is a document.
 *
 * pdf-lib rather than a headless browser: this runs inside a serverless
 * function with a ten-second budget, and it is pure JavaScript with no binary
 * to install and no Chromium to start.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.106, 0.11, 0.129);
const MUTED = rgb(0.42, 0.44, 0.48);
const BRAND = rgb(0.431, 0.086, 0.086); // --color-brand-500, #6e1616

/**
 * The standard PDF fonts speak WinAnsi and nothing else, and pdf-lib throws
 * rather than dropping a character it cannot write — which would turn one
 * unusual character in a name into a failure to save somebody's reply.
 *
 * Bangla is out of scope (§12), so the realistic input is English with the odd
 * curly quote pasted in from Word. Those are folded to their ASCII
 * equivalents; accents are stripped to their base letter; anything still left
 * becomes "?" rather than an exception.
 */
export function winAnsi(text: string): string {
  const folded = text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/₹/g, "Rs.")
    .replace(/৳|৲/g, "Tk.")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .normalize("NFC");
  // eslint-disable-next-line no-control-regex
  return folded.replace(/[^\x09\x0A\x20-\xFF]/g, "?");
}

type Font = Awaited<ReturnType<PDFDocument["embedFont"]>>;

/** Greedy word wrap. Long unbroken tokens — a URL, a reference number — are
 *  cut rather than allowed to run off the edge of the page. */
export function wrap(text: string, font: Font, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export type ShowCauseReplyInput = {
  employeeName: string;
  employeeCode: string | null;
  subject: string;
  letterBody: string;
  issuedByName: string;
  issuedOn: string;
  replyBody: string;
  repliedOn: string;
};

export async function showCauseReplyPdf(input: ShowCauseReplyInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(winAnsi(`Show-cause reply — ${input.employeeName}`));
  pdf.setProducer("FCSL HR Management System");
  pdf.setCreationDate(new Date());

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = A4.width - MARGIN * 2;

  let page = pdf.addPage([A4.width, A4.height]);
  let y = A4.height - MARGIN;

  const room = (needed: number) => {
    if (y - needed >= MARGIN) return;
    page = pdf.addPage([A4.width, A4.height]);
    y = A4.height - MARGIN;
  };

  const write = (text: string, font: Font, size: number, colour = INK, leading = size * 1.45) => {
    for (const line of wrap(winAnsi(text), font, size, width)) {
      room(leading);
      if (line) page.drawText(line, { x: MARGIN, y: y - size, size, font, color: colour });
      y -= leading;
    }
  };

  const rule = (gap = 14) => {
    room(gap + 2);
    y -= gap;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4.width - MARGIN, y },
      thickness: 0.75,
      color: rgb(0.85, 0.85, 0.87),
    });
    y -= gap;
  };

  write("FIRST CAPITAL SECURITIES LIMITED", bold, 9, BRAND, 14);
  write("Show-cause reply", bold, 19, INK, 26);
  y -= 4;
  write(
    `${input.employeeName}${input.employeeCode ? `  ·  ${input.employeeCode}` : ""}`,
    regular,
    11,
    MUTED,
    16,
  );
  rule();

  write("SUBJECT", bold, 8, MUTED, 13);
  write(input.subject, bold, 12, INK, 17);
  y -= 8;

  write(`LETTER ISSUED BY ${input.issuedByName.toUpperCase()} ON ${input.issuedOn.toUpperCase()}`, bold, 8, MUTED, 13);
  y -= 2;
  write(input.letterBody, regular, 10.5, MUTED, 15);
  rule();

  write(`REPLY GIVEN ON ${input.repliedOn.toUpperCase()}`, bold, 8, MUTED, 13);
  y -= 2;
  write(input.replyBody, regular, 11, INK, 16);

  // The provenance line, on every page. A page of this that turns up on its
  // own should say what it is and that nobody typed it afterwards.
  const pages = pdf.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawText(
      winAnsi(
        `Generated by the FCSL HR Management System from the reply as submitted  ·  page ${index + 1} of ${pages.length}`,
      ),
      { x: MARGIN, y: MARGIN - 22, size: 7.5, font: regular, color: MUTED },
    );
  });

  return pdf.save();
}
