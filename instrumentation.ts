import type { Instrumentation } from "next";

/**
 * Where a production failure stops being invisible.
 *
 * Next calls `onRequestError` for every uncaught server error — a render, a
 * route handler, a Server Action. Without it a 500 is seen by the employee who
 * hit it and by nobody else: they get an apology page, and the only person who
 * could fix it never finds out. That is the whole reason this file exists.
 *
 * One line, one marker, so it can be found in `vercel logs` and, later, have
 * an alert pointed at it. A hosted error tracker is the obvious upgrade and
 * would slot in exactly here; a dependency was not worth adding for the step
 * from "no signal" to "a signal".
 *
 * NOT written to AuditEvent. That table is the record of what people did, it
 * is append-only for ever, and a retry storm would bury a year of decisions
 * under stack traces. What the software got wrong is a different question from
 * what the staff did.
 */

const MARKER = "[fcsl-hrm:error]";

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const message = error instanceof Error ? error.message : String(error);

  // React replaces the error it shows the browser with an opaque digest. It is
  // the only thing connecting the "something went wrong" the employee is
  // looking at to the line below, so if there is one it goes in.
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;

  // `request.headers` is deliberately not logged. It carries the session
  // cookie, and a log line holding a live session is a way into the system
  // for anybody who can read the log.
  console.error(
    MARKER,
    JSON.stringify({
      at: new Date().toISOString(),
      method: request.method,
      path: request.path,
      route: context.routePath,
      kind: context.routeType,
      digest,
      message,
    }),
    error instanceof Error ? (error.stack ?? "") : "",
  );
};
