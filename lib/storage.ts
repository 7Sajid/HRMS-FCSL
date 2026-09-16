import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Document storage, addressed by KEY and never by URL.
 *
 * §6.1: "files sit in a private area with no public web address, so there is
 * no link that works if somebody forwards it." Every read goes through
 * app/api/download, which re-checks permission and records the view. Nothing
 * in this file produces a link a browser could follow on its own.
 *
 * Two drivers behind one interface: Supabase Storage in production, a local
 * folder in development. Feature code never knows which — which is also what
 * lets the bucket move to a Bangladeshi host later without touching a screen.
 */

const LOCAL_ROOT = path.join(process.cwd(), "storage");

function supabase(): { url: string; key: string; bucket: string } | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key, bucket: process.env.SUPABASE_BUCKET?.trim() || "hrm-documents" };
}

export function usingCloudStorage(): boolean {
  return supabase() !== null;
}

/**
 * Both headers, always.
 *
 * Supabase has two generations of server-side key and they authenticate
 * differently. The legacy `service_role` key is a JWT and `Authorization:
 * Bearer` alone is enough. The current `sb_secret_…` key is NOT a JWT, and
 * sending it as a bare bearer token makes the storage API try to parse it as
 * one — the reply is `403 Invalid Compact JWS`, and on some routes it surfaces
 * as `404 Bucket not found`, which sends you looking for a missing bucket that
 * is sitting right there.
 *
 * Sending `apikey` as well satisfies both generations, so the project can be
 * rotated from one to the other without touching this file.
 */
function authHeaders(key: string): Record<string, string> {
  return { apikey: key, authorization: `Bearer ${key}` };
}

// Vercel's filesystem is wiped on every deploy, so uploads written to disk
// there would be lost — silently, and only noticed when an auditor asks for a
// employee file. Fail at import rather than at the first upload.
if (process.env.NODE_ENV === "production" && process.env.VERCEL && !supabase()) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production. " +
      "Without them uploaded documents would be written to a filesystem that is wiped on every deploy.",
  );
}

/**
 * Where one document lives.
 *
 * The random component means a key cannot be guessed from an employee ID and a
 * document kind — belt and braces behind the authorisation check, not instead
 * of it.
 */
export function documentKey(employeeId: string, kind: string, originalName: string): string {
  const extension = path.extname(originalName).toLowerCase().slice(0, 10).replace(/[^.a-z0-9]/g, "");
  return `employee/${employeeId}/${kind.toLowerCase()}/${randomUUID()}${extension}`;
}

/** Rejects anything that could climb out of the storage root. */
function localPath(key: string): string {
  const resolved = path.resolve(LOCAL_ROOT, key);
  if (!resolved.startsWith(LOCAL_ROOT + path.sep)) {
    throw new Error("Refusing a storage key that points outside the storage folder.");
  }
  return resolved;
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const config = supabase();
  if (!config) {
    const target = localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
    return;
  }

  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`, {
    method: "POST",
    headers: {
      ...authHeaders(config.key),
      "content-type": contentType,
      "x-upsert": "true",
    },
    body: new Blob([new Uint8Array(bytes)]),
  });
  if (!response.ok) {
    throw new Error(`Storage upload failed (${response.status}): ${await response.text()}`);
  }
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  const config = supabase();
  if (!config) {
    try {
      return new Uint8Array(await readFile(localPath(key)));
    } catch {
      return null;
    }
  }

  const response = await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`, {
    headers: authHeaders(config.key),
  });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Remove a file. Used by exactly one thing: the one-year purge after an exit
 * (§12.2), which removes the FILES and keeps the record.
 */
export async function deleteObject(key: string): Promise<void> {
  const config = supabase();
  if (!config) {
    await unlink(localPath(key)).catch(() => {});
    return;
  }
  await fetch(`${config.url}/storage/v1/object/${config.bucket}/${key}`, {
    method: "DELETE",
    headers: authHeaders(config.key),
  }).catch(() => {});
}

/** For spotting a file uploaded twice under two names. */
export function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
