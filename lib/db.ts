import { PrismaClient } from "@prisma/client";

// Next.js reloads modules on every edit in development, and each reload would
// otherwise open a fresh pool until Postgres refuses the connection. Cache the
// client on globalThis, which survives the reload.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * `PRISMA_LOG_QUERIES=1` turns every query into an event.
 *
 * Off by default and never on in production. It exists because rule 7 — "every
 * list is paged; every count is capped" — and the N+1 that hid behind the
 * approvals inbox are both claims about how many queries a screen runs, and a
 * claim like that should be measurable rather than argued. `scripts/qa-regressions.ts`
 * counts with it; so can anybody wondering why a page is slow.
 */
const emitQueries = process.env.PRISMA_LOG_QUERIES === "1" && process.env.NODE_ENV !== "production";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: emitQueries
      ? [{ emit: "event", level: "query" }, "warn", "error"]
      : process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Did this fail because somebody else got there first?
 *
 * P2002 is a unique-constraint violation. Where a constraint exists precisely
 * to stop the same thing happening twice — a second decision at the same step
 * of an approval chain, a second open assignment of one trading terminal —
 * hitting it is not an error in the system, it is the system working. The
 * database is what actually holds the rule; this is only how the person on the
 * losing end gets told, instead of being shown a crash.
 */
export function lostTheRace(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}
