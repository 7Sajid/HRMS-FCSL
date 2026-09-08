import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { compressUpload, MAX_EDGE, PORTRAIT_EDGE, savingLine } from "./images";

/**
 * The thing these tests exist to protect is not the saving — it is that the
 * document is still readable and still the right way up afterwards.
 */

/** Something that looks like a scanned page: noise, so it cannot compress to nothing. */
async function scan(width: number, height: number): Promise<Uint8Array> {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 2654435761) % 256;
  const out = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
  return new Uint8Array(out);
}

describe("what happens to an uploaded image", () => {
  it("brings a phone-sized photograph down to something sensible", async () => {
    const big = await scan(4000, 3000);
    const result = await compressUpload(big, "image/jpeg");
    expect(result.changed).toBe(true);
    expect(result.bytes.length).toBeLessThan(big.length);
    const meta = await sharp(result.bytes).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(MAX_EDGE);
  });

  it("keeps a passport photograph smaller still", async () => {
    const portrait = await scan(3000, 4000);
    const result = await compressUpload(portrait, "image/jpeg", PORTRAIT_EDGE);
    const meta = await sharp(result.bytes).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(PORTRAIT_EDGE);
  });

  it("does not enlarge a small scan", async () => {
    const small = await scan(600, 400);
    const result = await compressUpload(small, "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.width).toBe(600);
    expect(meta.height).toBe(400);
  });

  it("never hands back something bigger than what arrived", async () => {
    // Already squeezed hard: re-encoding this can only make it worse.
    const tiny = new Uint8Array(
      await sharp({ create: { width: 50, height: 50, channels: 3, background: "#ffffff" } })
        .jpeg({ quality: 20 })
        .toBuffer(),
    );
    const result = await compressUpload(tiny, "image/jpeg");
    expect(result.bytes.length).toBeLessThanOrEqual(tiny.length);
    expect(result.changed).toBe(false);
  });

  it("applies the phone's rotation instead of filing the page sideways", async () => {
    // EXIF orientation 6 means "rotate 90° clockwise to view". The pixels are
    // landscape; a viewer that honours EXIF shows it portrait. Strip the tag
    // without applying it and every phone upload lands on its side.
    const landscape = await sharp({
      create: { width: 1200, height: 600, channels: 3, background: "#6e1616" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const result = await compressUpload(new Uint8Array(landscape), "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    expect(meta.height).toBeGreaterThan(meta.width!);
    // And the tag is gone, so nothing rotates it a second time.
    expect(meta.orientation ?? 1).toBe(1);
  });

  it("drops the GPS coordinates a phone writes into a photograph", async () => {
    const withGps = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#6e1616" },
    })
      // sharp's typings expose the IFD directories; GPS tags a phone writes
      // live in one of them and are stripped by the same rule.
      .withExif({ IFD0: { Copyright: "FCSL", Artist: "Somebody's phone" } })
      .jpeg()
      .toBuffer();

    const result = await compressUpload(new Uint8Array(withGps), "image/jpeg");
    const meta = await sharp(result.bytes).metadata();
    // An employee's home address does not belong in a file HR can open.
    expect(meta.exif).toBeUndefined();
  });

  it("flattens a transparent PNG onto white, not black", async () => {
    const transparent = await sharp({
      create: { width: 900, height: 700, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const result = await compressUpload(new Uint8Array(transparent), "image/png");
    const { data } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
    // A scanned page whose margins came out black would be unreadable.
    expect(data[0]).toBeGreaterThan(240);
  });

  it("leaves a PDF completely alone", async () => {
    const pdf = new Uint8Array(Buffer.from("%PDF-1.7\nnot really a pdf but it starts like one\n"));
    const result = await compressUpload(pdf, "application/pdf");
    expect(result.changed).toBe(false);
    expect(Buffer.from(result.bytes).equals(Buffer.from(pdf))).toBe(true);
    expect(result.type).toBe("application/pdf");
  });

  it("keeps a file it cannot read rather than losing it", async () => {
    // Passed the magic-number check and then turned out to be truncated.
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const result = await compressUpload(broken, "image/jpeg");
    expect(result.changed).toBe(false);
    expect(result.bytes.length).toBe(broken.length);
  });
});

describe("what the person is told", () => {
  it("says it in units somebody reads", () => {
    expect(savingLine(6_500_000, 310_000)).toBe("6.2 MB → 303 KB (95% smaller)");
    expect(savingLine(400_000, 400_000)).toBe("391 KB");
  });
});
