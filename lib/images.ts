import sharp from "sharp";
import type { SniffedType } from "./uploads";

/**
 * Shrinking what people upload (§6.1).
 *
 * Nothing here changes what a document IS. It changes how many bytes it takes
 * to say it, and it is the difference between a staff file costing a few
 * gigabytes and costing a hundred: nothing shrank anything, so a phone
 * photograph of a national ID arrived at six or eight megabytes and was stored
 * at six or eight megabytes, when three hundred kilobytes reads identically.
 *
 * The rule this is written around: THE DOCUMENT MUST STAY READABLE. This is a
 * regulated staff file and the point of an NID scan is the number on it. So
 * the settings below are deliberately conservative — 2,000 pixels on the long
 * edge is an A4 page at about 170 dots per inch, better than most photocopies
 * anybody files on paper, and quality 82 is where JPEG stops being visibly
 * lossy on text. Saving another 20% is not worth one unreadable certificate.
 */

/** An A4 page at ~170 DPI. Text, stamps and signatures all survive this. */
export const MAX_EDGE = 2000;

/** A passport photograph is a face in a box. It needs nothing like a page. */
export const PORTRAIT_EDGE = 1200;

/** Where JPEG stops being visibly lossy on printed text. */
export const QUALITY = 82;

export type Compressed = {
  bytes: Uint8Array;
  type: NonNullable<SniffedType>;
  /** What it arrived as, for the record. */
  originalSize: number;
  /** False when the original was already smaller, or could not be read. */
  changed: boolean;
};

/**
 * PDFs are passed straight through, untouched.
 *
 * Shrinking one properly means re-encoding the images inside it, which needs
 * Ghostscript or an equivalent — a second binary, on a serverless function,
 * for a file type that is usually already compressed. A scanned PDF that is
 * genuinely enormous is better dealt with by asking the person to scan at a
 * lower setting than by this system quietly rewriting a legal document.
 */
export async function compressUpload(
  input: Uint8Array,
  type: NonNullable<SniffedType>,
  maxEdge: number = MAX_EDGE,
): Promise<Compressed> {
  const originalSize = input.length;
  if (type === "application/pdf") {
    return { bytes: input, type, originalSize, changed: false };
  }

  try {
    const out = await sharp(input, { failOn: "none" })
      // FIRST, and it is not optional. A phone writes the orientation into
      // EXIF and leaves the pixels alone; stripping EXIF without applying it
      // first turns every portrait photograph on its side. `rotate()` with no
      // argument means "use what EXIF says", after which the tag is no longer
      // needed.
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      // A scan has no transparency to preserve, and JPEG has nowhere to put
      // it. White rather than black, because the alternative turns the margins
      // of a scanned page into a black border.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      // Metadata is dropped, which is the default and is wanted: a photograph
      // taken on a phone carries the GPS coordinates of wherever it was taken,
      // and an employee's home address does not belong in a company file that
      // HR can open.
      .toBuffer();

    // Never hand back something bigger than what arrived. An already-optimised
    // file re-encoded can grow, and there is no sense storing the worse one.
    if (out.length >= originalSize) {
      return { bytes: input, type, originalSize, changed: false };
    }
    return { bytes: new Uint8Array(out), type: "image/jpeg", originalSize, changed: true };
  } catch {
    // A file that sharp cannot read is still a file somebody needs in their
    // record. The upload was already checked and accepted; losing it here
    // because it could not be made smaller would be the wrong trade entirely.
    return { bytes: input, type, originalSize, changed: false };
  }
}

/** "6.2 MB → 310 KB (95% smaller)" — for the audit line and the screen. */
export function savingLine(originalSize: number, size: number): string {
  const show = (n: number) =>
    n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (size >= originalSize) return show(size);
  const percent = Math.round((1 - size / originalSize) * 100);
  return `${show(originalSize)} → ${show(size)} (${percent}% smaller)`;
}
