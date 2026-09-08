import { prisma } from "@/lib/db";

/**
 * Is the system actually up?
 *
 * "Up" means the database answers, not that Next is running. A deployment
 * whose pooler credentials are wrong serves a perfect sign-in page and fails
 * on the first query, and an uptime check that only fetches HTML calls that
 * healthy. So this asks Postgres.
 *
 * Deliberately open — no session — because a monitor cannot sign in. Which is
 * exactly why the reply is two words. No version, no hostname, no counts, no
 * error text: an unauthenticated endpoint says whether the lights are on and
 * nothing whatsoever about the building.
 *
 * This file on its own detects nothing. It is worth having only once something
 * is pointed at it on a schedule.
 */

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    // 503 rather than 500: this is "not ready", which is the status monitors
    // and load balancers are built to understand.
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
