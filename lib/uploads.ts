/**
 * Upload validation, shared by the browser and the server so the two cannot
 * disagree about what is allowed.
 *
 * The server half does not consult the declared MIME type AT ALL. A browser
 * sends whatever the file's extension suggests, and an attacker sends whatever
 * they like; the only honest answer to "what is this file" is in its first few
 * bytes. The stored content-type is then derived from what the file actually
 * is, so a document served back cannot become script because of what somebody
 * called it.
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type SniffedType = "application/pdf" | "image/jpeg" | "image/png" | null;

/** Magic numbers. Short, and the whole of the trust decision. */
export function sniffType(bytes: Uint8Array): SniffedType {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) return "image/png";

  // "%PDF-" is usually at byte 0 but the specification allows leading junk, and
  // real scanners emit it. Search the first kilobyte rather than rejecting a
  // file a person can plainly open.
  const head = bytes.subarray(0, 1024);
  const marker = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let i = 0; i + marker.length <= head.length; i += 1) {
    if (marker.every((b, j) => head[i + j] === b)) return "application/pdf";
  }
  return null;
}

export const EXTENSION_FOR: Record<NonNullable<SniffedType>, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

export type UploadProblem = { message: string };

/**
 * Everything the server checks. Returns a sentence for the person, or the
 * type the file actually is.
 */
export function checkUpload(
  bytes: Uint8Array,
  accepts: readonly string[],
  declaredName: string,
): { ok: true; type: NonNullable<SniffedType> } | { ok: false; message: string } {
  if (bytes.length === 0) return { ok: false, message: "That file is empty." };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `That file is ${formatBytes(bytes.length)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)} — try scanning at a lower resolution.`,
    };
  }

  const type = sniffType(bytes);
  if (!type) {
    return {
      ok: false,
      message: "That does not look like a PDF, JPG or PNG. Please upload a scan or a photograph.",
    };
  }

  if (accepts.length && !accepts.includes(type)) {
    const names = accepts.map((a) => a.replace("application/", "").replace("image/", "").toUpperCase());
    return {
      ok: false,
      message: `This box takes ${listOf(names)} only. That file is ${type.split("/")[1].toUpperCase()}.`,
    };
  }

  // Not a security check — the content sniff already decided. This stops a
  // scan called "cv.pdf" that is really a JPEG from being stored as cv.pdf and
  // failing to open on somebody's desk later.
  void declaredName;
  return { ok: true, type };
}

/** A filename safe to put in a Content-Disposition header. */
export function safeFileName(name: string, type: NonNullable<SniffedType>): string {
  const base = name.replace(/\.[^.]*$/, "").replace(/[^\w .()-]/g, "_").slice(0, 80) || "document";
  return `${base}${EXTENSION_FOR[type]}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "PDF", "PDF or JPG", "PDF, JPG or PNG" */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** For the file input's accept attribute. */
export function acceptAttribute(accepts: readonly string[]): string {
  return accepts.join(",");
}
