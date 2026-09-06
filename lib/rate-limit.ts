import { prisma } from "./db";

/**
 * Sign-in rate limiting, kept in the database.
 *
 * In-memory counters are useless here: every serverless invocation gets its
 * own memory, so an attacker spreading guesses across invocations meets a
 * counter that is always zero.
 */

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Checked BEFORE the user is looked up and before bcrypt runs, so a flood of
 * guesses costs one index scan rather than a hash comparison each.
 */
export async function isRateLimited(key: string): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MS);
  const failures = await prisma.loginAttempt.count({ where: { key, createdAt: { gte: since } } });
  return failures >= MAX_FAILURES;
}

export async function recordFailure(key: string): Promise<void> {
  await prisma.loginAttempt.create({ data: { key } });
  // Opportunistic cleanup, so the table does not grow for ever and nobody has
  // to remember a scheduled job for it. Cheap, and only on the failure path.
  if (Math.random() < 0.05) {
    await prisma.loginAttempt
      .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - WINDOW_MS * 4) } } })
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
