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
