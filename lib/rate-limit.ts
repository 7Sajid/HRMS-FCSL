import { prisma } from "./db";

/**
 * Rate limiting, kept in the database.
 *
 * In-memory counters are useless here: every serverless invocation gets its
 * own memory, so an attacker spreading guesses across invocations meets a
 * counter that is always zero.
 *
 * The table is still called LoginAttempt because sign-in was the first thing
 * that needed it, and renaming it would mean a migration that buys nothing.
 * It is a bucket of timestamps under a key; the key says what is being counted.
 */

export type Limit = { max: number; windowMs: number };

/** Password guessing. Ten wrong answers is well past a typo. */
export const SIGN_IN: Limit = { max: 10, windowMs: 15 * 60 * 1000 };

/**
 * A signed-in person doing something expensive — sending files in, or pulling
 * a whole employee list out.
 *
 * High enough that HR working quickly through a review queue never meets it,
 * low enough that a script cannot sit on the endpoint all afternoon. This is a
 * brake, not a wall: anybody who reaches it is already authenticated and
 * already audited, so what it protects against is cost and noise, not
 * disclosure. The limits that stop disclosure are in lib/permissions.ts.
 */
export const BURST: Limit = { max: 60, windowMs: 10 * 60 * 1000 };

/** Kept a little past the longest window above, and no longer. */
const RETENTION_MS = 60 * 60 * 1000;

/**
 * Checked BEFORE the user is looked up and before bcrypt runs, so a flood of
 * guesses costs one index scan rather than a hash comparison each.
 */
export async function isRateLimited(key: string, limit: Limit = SIGN_IN): Promise<boolean> {
  const since = new Date(Date.now() - limit.windowMs);
  const hits = await prisma.loginAttempt.count({ where: { key, createdAt: { gte: since } } });
  return hits >= limit.max;
}

/**
 * One tick against a key.
 *
 * Sign-in records only failures and clears the key on success. The expensive
 * endpoints record every attempt and clear nothing — a *successful* upload is
 * precisely the thing being limited there, so forgiving it would defeat the
 * count.
 */
export async function recordAttempt(key: string): Promise<void> {
  await prisma.loginAttempt.create({ data: { key } });
  // Opportunistic cleanup, so the table does not grow for ever and nobody has
  // to remember a scheduled job for it. Cheap, and rare.
  if (Math.random() < 0.05) {
    await prisma.loginAttempt
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } } })
      .catch(() => {});
  }
}

export async function clearFailures(key: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { key } }).catch(() => {});
}

/**
 * The caller's address, as far as it can be known behind a proxy.
 *
 * Returns "unknown" rather than throwing, and "unknown" is a perfectly good
 * rate-limit bucket — it simply means every unattributable request shares one.
 */
export function callerAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}
