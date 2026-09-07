import { createHash, timingSafeEqual } from "node:crypto";
import { isJobName, runJobs, JOB_NAMES } from "@/lib/jobs";

/**
 * The scheduled jobs, over HTTP (§8, P5.4).
 *
 * Vercel Cron calls a URL, which means this endpoint is on the public internet
 * whatever the schedule says. It is guarded by a shared secret compared in
 * constant time, and it answers 404 to everything it does not recognise —
 * because a 401 tells an unauthenticated caller that the door exists and is
 * worth knocking on.
 *
 * `CRON_SECRET` unset means the jobs do not run. That is the correct failure:
 * a deploy that forgot the variable should stop sending reminders loudly
 * rather than expose an endpoint that empties somebody's document storage.
 *
 * ONE schedule in vercel.json, not six. `runJobs` already runs them in order
 * with the digest last, so a single entry gets the ordering for free, cannot
 * drift out of sequence, and does not spend the cron allowance that Vercel's
 * cheaper plans meter. `?job=` stays for running one by hand.
 *
 * The schedule is `0 2 * * *` — Vercel Cron is UTC and Dhaka is UTC+6, so
 * that is eight in the morning here. §8 asks for a MORNING summary, and 02:00
 * would have been two in the morning to whoever specified it.
 */

// The purge touches storage and the digest walks every unread notification;
// neither belongs on the edge, and both need more than a few seconds.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. The query-string
  // form is accepted too, for the manual "run it now" case from a terminal
  // where setting a header is more trouble than it is worth.
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
  const query = new URL(request.url).searchParams.get("secret") ?? "";
  const offered = bearer || query;
  if (!offered) return false;

  // Constant time, so the comparison cannot be used to learn the secret one
  // character at a time. Hashed first because timingSafeEqual throws on a
  // length mismatch, and that throw would itself leak the length — SHA-256
  // gives both sides 32 bytes whatever was offered.
  return timingSafeEqual(sha256(offered), sha256(secret));
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export async function GET(request: Request): Promise<Response> {
  if (!authorised(request)) return new Response("Not found", { status: 404 });

  const requested = new URL(request.url).searchParams.get("job") ?? "all";
  if (requested !== "all" && !isJobName(requested)) {
    return Response.json({ error: "Unknown job", known: JOB_NAMES }, { status: 400 });
  }

  const started = Date.now();
  const results = await runJobs(requested as never);

  // Returned as JSON rather than an empty 200 so the Vercel log line says what
  // happened. "Cron ran" is not information; "certificates: 12 considered, 1
  // warned" is the thing you want in front of you at nine in the evening.
  return Response.json({
    ranAt: new Date().toISOString(),
    tookMs: Date.now() - started,
    results,
  });
}
