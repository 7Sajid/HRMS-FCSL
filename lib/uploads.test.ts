import { describe, expect, it } from "vitest";
import { checkUpload, formatBytes, safeFileName, sniffType } from "./uploads";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n%����\n")]);
const SCAN = ["application/pdf", "image/jpeg", "image/png"];

describe("what a file actually is, not what it claims", () => {
  it("recognises the three types the system accepts", () => {
    expect(sniffType(JPEG)).toBe("image/jpeg");
    expect(sniffType(PNG)).toBe("image/png");
    expect(sniffType(PDF)).toBe("application/pdf");
  });

  it("finds %PDF- past leading junk, which real scanners emit", () => {
    const padded = new Uint8Array([...new Uint8Array(60).fill(0x20), ...PDF]);
    expect(sniffType(padded)).toBe("application/pdf");
  });

  it("refuses anything else", () => {
    expect(sniffType(new Uint8Array(Buffer.from("<html><script>")))).toBeNull();
    expect(sniffType(new Uint8Array(Buffer.from("GIF89a")))).toBeNull();
    expect(sniffType(new Uint8Array(0))).toBeNull();
  });

  it("ignores the declared name entirely", () => {
    // An HTML file named .pdf is the whole reason the sniff exists.
    const html = new Uint8Array(Buffer.from("<!doctype html><script>alert(1)</script>"));
    const result = checkUpload(html, SCAN, "nid-scan.pdf");
    expect(result.ok).toBe(false);
    // ...and a genuine JPEG named .pdf is still accepted, as a JPEG.
    const jpg = checkUpload(JPEG, SCAN, "cv.pdf");
    expect(jpg).toEqual({ ok: true, type: "image/jpeg" });
  });
});

describe("what the person is told when it is refused", () => {
  it("names the size and suggests something they can do", () => {
    const huge = new Uint8Array(11 * 1024 * 1024);
    huge.set(JPEG);
    const result = checkUpload(huge, SCAN, "photo.jpg");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("11.0 MB");
      expect(result.message).toContain("lower resolution");
    }
  });

  it("says which box takes what, when the type is wrong for it", () => {
    const result = checkUpload(JPEG, ["application/pdf"], "cv.jpg");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The CV box is PDF only (§4).
      expect(result.message).toContain("PDF only");
      expect(result.message).toContain("JPEG");
    }
  });

  it("has a sentence for an empty file", () => {
    const result = checkUpload(new Uint8Array(0), SCAN, "empty.pdf");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe("That file is empty.");
  });
});

describe("stored filenames", () => {
  it("takes the extension from the content, not from the name", () => {
    expect(safeFileName("cv.pdf", "image/jpeg")).toBe("cv.jpg");
  });

  it("strips anything that could confuse a download header", () => {
    expect(safeFileName('nid"; drop.pdf', "application/pdf")).toBe("nid__ drop.pdf");
  });

  it("cannot emit a separator, a quote or a newline, whatever it is given", () => {
    // Asserted as properties rather than as exact strings: what matters is
    // that nothing here can break out of a Content-Disposition header or name
    // a path, not the particular way a hostile name gets flattened.
    for (const hostile of [
      "../../etc/passwd",
      'a"; filename="evil.exe',
      "line\nbreak.pdf",
      "sub/dir/file.pdf",
      "\\windows\\unc.pdf",
      "%00null.pdf",
    ]) {
      const safe = safeFileName(hostile, "application/pdf");
      expect(safe).not.toMatch(/[/\\"\r\n\0]/);
      expect(safe.endsWith(".pdf")).toBe(true);
      expect(safe.length).toBeGreaterThan(4);
    }
  });

  it("never produces an empty name", () => {
    expect(safeFileName("", "application/pdf")).toBe("document.pdf");
    expect(safeFileName("!!!.png", "image/png")).toBe("___.png");
  });
});

describe("sizes people can read", () => {
  it("rounds to something a person would say out loud", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
