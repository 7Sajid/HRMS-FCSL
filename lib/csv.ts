/**
 * CSV, written for Excel on a Windows machine in Dhaka.
 *
 * Every export from this system is a list of real people, and every export is
 * itself recorded in the permanent record — "a list of every employee's
 * details leaving the building is exactly the kind of event an auditor asks
 * about" (§5.3).
 */

/**
 * A cell that Excel would otherwise execute.
 *
 * A value beginning = + - @ or a control character is treated by Excel and
 * LibreOffice as a formula, so an employee whose name or note starts with one
 * becomes code that runs on the machine of whoever opens the file. Prefixing a
 * tab makes it text again and is invisible in the cell.
 */
function neutralise(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `\t${value}` : value;
}

/** Always quoted. A name with a comma in it is not an edge case. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${neutralise(text).replace(/"/g, '""')}"`;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  // CRLF, because Excel on Windows is the destination and LF alone puts the
  // whole file on one row there.
  //
  // The BOM matters more: without it Excel reads the file as the local
  // codepage and Bangla names, and any Latin-1 accent, arrive as mojibake.
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** "fcsl-employees-2026-09-06.csv" */
export function exportFileName(kind: string, when: Date = new Date()): string {
  return `fcsl-${kind}-${when.toISOString().slice(0, 10)}.csv`;
}

export function csvResponse(body: string, fileName: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
      // An export is a snapshot of people's details. It must not sit in a
      // proxy or a browser cache for the next person on that machine.
      "cache-control": "no-store, max-age=0",
    },
  });
}

/**
 * Read a CSV back. Handles quoted cells, embedded commas, doubled quotes and
 * both line endings, because the file is coming from somebody's Excel and not
 * from us.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && clean[i + 1] === "\n") i += 1;
      row.push(cell);
      // A trailing newline should not become a row of one empty cell.
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}
