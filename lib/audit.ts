import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./db";

/**
 * The permanent record (§6, "Underneath all ten").
 *
 * This part has no screen of its own and most people will never think about
 * it. It is the reason the system can be trusted: every action that changes
 * something, or reveals somebody's private information, writes one line that
 * can never be edited or deleted — not by HR, not by the Super Admin, not by
 * the person who built the software.
 *
 * That last clause is not a promise this file can keep on its own. It is kept
 * by a Postgres trigger, installed in its own migration, which refuses UPDATE,
 * DELETE and TRUNCATE on the table. An auditor's real question is not "do you
 * have a log" but "what stops somebody editing it", and the answer has to be
 * something other than good intentions.
 */

/**
 * The closed set of things that can be recorded.
 *
 * `AuditEvent.action` is a String column rather than a Postgres enum on
 * purpose. The log is append-only, so a name used in 2026 has to keep
 * rendering correctly for ever. An enum would need a migration to add a value
 * and could not drop one without a column rewrite; a TypeScript union gives
 * the compile-time safety without touching the database.
 *
 * NAMES ARE NEVER REMOVED FROM THIS UNION, even when the feature that wrote
 * them is gone. Removing one would make old rows render as raw keys and drop
 * them out of every filter, which is a quiet way of editing history.
 */
export type AuditAction =
  // Authentication
  | "auth.signed_in"
  | "auth.sign_in_failed"
  | "auth.signed_out"
  | "auth.password_changed"
  | "auth.temp_password_issued"
  | "auth.session_revoked"
  // Accounts
  | "account.created"
  | "account.disabled"
  | "account.enabled"
  | "account.role_changed"
  // The locked door and documents
  | "documents.submitted"
  | "documents.approved"
  | "documents.sent_back"
  | "document.uploaded"
  | "document.accepted"
  | "document.rejected"
  | "document.superseded"
  | "document.viewed"
  | "document.purged"
  // The employee record
  | "employee.created"
  | "employee.id_issued"
  | "employee.updated"
  | "employee.assigned"
  | "employee.marked_left"
  | "employee.imported"
  | "bank.updated"
  // Emergency contacts and corrections
  | "contact.proposed"
  | "contact.approved"
  | "contact.rejected"
  | "correction.requested"
  | "correction.resolved"
  | "correction.declined"
  // Leave
  | "leave.applied"
  | "leave.approved_step"
  | "leave.denied"
  | "leave.granted"
  | "leave.withdrawn"
  | "leave.cancelled"
  | "leave.entitlement_granted"
  // Attendance
  | "attendance.sheet_submitted"
  | "attendance.corrected"
  | "attendance.published"
  // Requisition
  | "requisition.raised"
  | "requisition.approved_step"
  | "requisition.denied"
  | "requisition.approved"
  | "requisition.fulfilled"
  // Registers
  | "certificate.recorded"
  | "certificate.renewed"
  | "certificate.surrendered"
  | "terminal.created"
  | "terminal.assigned"
  | "terminal.released"
  | "terminal.status_changed"
  // Exit
  | "exit.recorded"
  | "exit.clearance_cleared"
  | "exit.completed"
  // Compliance
  | "showcause.issued"
  | "showcause.viewed"
  | "showcause.replied"
  | "showcause.closed"
  // Organisation and settings
  | "branch.created"
  | "branch.updated"
  | "branch.closed"
  | "orglist.created"
  | "orglist.retired"
  | "settings.updated"
  | "leavetype.created"
  | "leavetype.rule_added"
  | "holiday.added"
  | "holiday.removed"
  | "calendar.announced"
  // Anything leaving the building
  | "export.employees"
  | "export.audit"
  | "export.report"
  // The system itself
  | "system.bootstrap_super_admin"
  | "system.cron_ran"
  /** Installation-time checks written deliberately, so they are never mistaken
   *  for the events they are testing. */
  | "system.deployment_check"
  | "notification.email_failed";

export const ACTION_LABELS: Record<AuditAction, string> = {
  "auth.signed_in": "Signed in",
  "auth.sign_in_failed": "Failed sign-in attempt",
  "auth.signed_out": "Signed out",
  "auth.password_changed": "Changed password",
  "auth.temp_password_issued": "Temporary password issued",
  "auth.session_revoked": "Session revoked",

  "account.created": "Account created",
  "account.disabled": "Account disabled",
  "account.enabled": "Account re-enabled",
  "account.role_changed": "Role changed",

  "documents.submitted": "Documents submitted for review",
  "documents.approved": "Documents approved — panel opened",
  "documents.sent_back": "Documents sent back",
  "document.uploaded": "Document uploaded",
  "document.accepted": "Document accepted",
  "document.rejected": "Document rejected",
  "document.superseded": "Document replaced",
  "document.viewed": "Document opened",
  "document.purged": "Documents purged after one year",

  "employee.created": "Employee record created",
  "employee.id_issued": "Employee ID issued",
  "employee.updated": "Employee details changed",
  "employee.assigned": "Branch, department or manager set",
  "employee.marked_left": "Marked as left",
  "employee.imported": "Imported from spreadsheet",
  "bank.updated": "Bank details changed",

  "contact.proposed": "Emergency contact change proposed",
  "contact.approved": "Emergency contact change approved",
  "contact.rejected": "Emergency contact change rejected",
  "correction.requested": "Correction requested",
  "correction.resolved": "Correction made",
  "correction.declined": "Correction declined",

  "leave.applied": "Leave applied for",
  "leave.approved_step": "Leave approved at a step",
  "leave.denied": "Leave denied",
  "leave.granted": "Leave finally granted",
  "leave.withdrawn": "Leave withdrawn",
  "leave.cancelled": "Leave cancelled",
  "leave.entitlement_granted": "Leave entitlement granted",

  "attendance.sheet_submitted": "Branch attendance submitted",
  "attendance.corrected": "Attendance corrected by HR",
  "attendance.published": "Monthly attendance published",

  "requisition.raised": "Requisition raised",
  "requisition.approved_step": "Requisition approved at a step",
  "requisition.denied": "Requisition denied",
  "requisition.approved": "Requisition finally approved",
  "requisition.fulfilled": "Requisition fulfilled",

  "certificate.recorded": "RM certificate recorded",
  "certificate.renewed": "RM certificate renewed",
  "certificate.surrendered": "RM certificate surrendered",
  "terminal.created": "Trading terminal added",
  "terminal.assigned": "Terminal assigned",
  "terminal.released": "Terminal released",
  "terminal.status_changed": "Terminal status changed",

  "exit.recorded": "Exit recorded",
  "exit.clearance_cleared": "Clearance item cleared",
  "exit.completed": "Exit completed",

  "showcause.issued": "Show-cause letter issued",
  "showcause.viewed": "Show-cause file opened",
  "showcause.replied": "Show-cause reply submitted",
  "showcause.closed": "Show-cause closed",

  "branch.created": "Branch created",
  "branch.updated": "Branch details changed",
  "branch.closed": "Branch closed",
  "orglist.created": "Department, designation or grade added",
  "orglist.retired": "Department, designation or grade retired",
  "settings.updated": "Setting changed",
  "leavetype.created": "Leave type added",
  "leavetype.rule_added": "Leave entitlement rule changed",
  "holiday.added": "Public holiday added",
  "holiday.removed": "Public holiday removed",
  "calendar.announced": "Calendar announcement made",

  "export.employees": "Employee list exported",
  "export.audit": "Permanent record exported",
  "export.report": "Report exported",

  "system.bootstrap_super_admin": "First Super Admin created at installation",
  "system.cron_ran": "Scheduled job ran",
  "system.deployment_check": "Installation check",
  "notification.email_failed": "Notification email failed",
};

/** Filter chips for the viewer, in the order the HR Head thinks about them. */
export const ACTION_GROUPS: { label: string; actions: AuditAction[] }[] = [
  {
    label: "Access",
    actions: [
      "auth.signed_in",
      "auth.sign_in_failed",
      "auth.signed_out",
      "auth.password_changed",
      "auth.temp_password_issued",
      "auth.session_revoked",
      "account.created",
      "account.disabled",
      "account.enabled",
      "account.role_changed",
    ],
  },
  {
    label: "Documents",
    actions: [
      "documents.submitted",
      "documents.approved",
      "documents.sent_back",
      "document.uploaded",
      "document.accepted",
      "document.rejected",
      "document.superseded",
      "document.viewed",
      "document.purged",
    ],
  },
  {
    label: "Employee records",
    actions: [
      "employee.created",
      "employee.id_issued",
      "employee.updated",
      "employee.assigned",
      "employee.marked_left",
      "employee.imported",
      "bank.updated",
      "contact.proposed",
      "contact.approved",
      "contact.rejected",
      "correction.requested",
      "correction.resolved",
      "correction.declined",
    ],
  },
  {
    label: "Leave and attendance",
    actions: [
      "leave.applied",
      "leave.approved_step",
      "leave.denied",
      "leave.granted",
      "leave.withdrawn",
      "leave.cancelled",
      "leave.entitlement_granted",
      "attendance.sheet_submitted",
      "attendance.corrected",
      "attendance.published",
    ],
  },
  {
    label: "Requisition and compliance",
    actions: [
      "requisition.raised",
      "requisition.approved_step",
      "requisition.denied",
      "requisition.approved",
      "requisition.fulfilled",
      "showcause.issued",
      "showcause.viewed",
      "showcause.replied",
      "showcause.closed",
    ],
  },
  {
    label: "Registers and exits",
    actions: [
      "certificate.recorded",
      "certificate.renewed",
      "certificate.surrendered",
      "terminal.created",
      "terminal.assigned",
      "terminal.released",
      "terminal.status_changed",
      "exit.recorded",
      "exit.clearance_cleared",
      "exit.completed",
    ],
  },
  {
    label: "Configuration",
    actions: [
      "branch.created",
      "branch.updated",
      "branch.closed",
      "orglist.created",
      "orglist.retired",
      "settings.updated",
      "leavetype.created",
      "leavetype.rule_added",
      "holiday.added",
      "holiday.removed",
      "calendar.announced",
    ],
  },
  {
    label: "Exports and system",
    actions: [
      "export.employees",
      "export.audit",
      "export.report",
      "system.bootstrap_super_admin",
      "system.cron_ran",
      "system.deployment_check",
      "notification.email_failed",
    ],
  },
];

/** A row written before this action name existed, or after it was retired. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

/**
 * The actor, as they were at the time.
 *
 * Takes only these three fields on purpose. Passing a whole user object here
 * is how a password hash ends up in a log that cannot be edited afterwards.
 */
export type Actor = { id: string; fullName: string; role: Role };

export function actorFrom(user: { id: string; fullName?: string | null; email?: string; role: Role }): Actor {
  return {
    id: user.id,
    // An account created three fields at a time may not have a name yet, and a
    // log line reading "(unnamed) approved …" helps nobody.
    fullName: user.fullName?.trim() || user.email || "Unknown",
    role: user.role,
  };
}

export type AuditInput = {
  action: AuditAction;
  actor?: Actor | null;
  targetType?: string;
  targetId?: string;
  targetLabel?: string;
  detail?: Prisma.InputJsonValue;
  ip?: string;
  /** The caller's transaction. See below — this is the whole point. */
  tx?: Prisma.TransactionClient;
};

function toRow(input: AuditInput) {
  return {
    action: input.action,
    actorId: input.actor?.id ?? null,
    actorName: input.actor?.fullName ?? "System",
    actorRole: input.actor?.role ?? "",
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? "",
    detail: input.detail,
    ip: input.ip ?? "",
  };
}

/**
 * Write a line, and fail the caller if it cannot be written.
 *
 * An action and its audit row are ONE TRANSACTION. Pass `tx` and the row joins
 * the caller's transaction, so an approval that cannot be logged does not
 * happen. That is the correct trade: an unlogged approval in a BSEC-regulated
 * brokerage is worse than a failed one, because the failed one is visible.
 */
export async function record(input: AuditInput): Promise<void> {
  const client = input.tx ?? prisma;
  await client.auditEvent.create({ data: toRow(input) });
}

/**
 * Write a line, and never let the failure reach the caller.
 *
 * ONLY for observations *around* an action rather than the action itself — a
 * sign-in, a failed sign-in, an export. Refusing somebody's login because the
 * log table is unavailable punishes the wrong person for the wrong problem.
 *
 * If you are reaching for this inside a mutation, you want `record` with `tx`.
 */
export async function recordQuietly(input: AuditInput): Promise<void> {
  try {
    await record(input);
  } catch (error) {
    console.error("[audit] failed to write", input.action, error);
  }
}

/**
 * A before/after pair for `detail`, with unchanged fields dropped.
 *
 * §6 asks for "every change to somebody's personal, bank or employment
 * details, with the old value and the new". Recording fields that did not
 * change turns the log into noise and hides the one line that mattered.
 */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): Prisma.InputJsonValue | undefined {
  const changes: Record<string, { from: JsonScalar; to: JsonScalar }> = {};
  for (const [key, next] of Object.entries(after)) {
    const previous = before[key as keyof T];
    if (next === undefined) continue;
    const same =
      previous instanceof Date && next instanceof Date
        ? previous.getTime() === next.getTime()
        : previous === next;
    if (!same) changes[key] = { from: serialise(previous), to: serialise(next) };
  }
  return Object.keys(changes).length ? { changes } : undefined;
}

type JsonScalar = string | number | boolean | null;

/**
 * Reduce a value to something a JSON column can hold and a person can read.
 *
 * Anything that is not already a scalar is stringified rather than nested: the
 * log is read by a person looking for "what did this used to say", and a
 * nested object in that column is a thing they have to decode.
 */
function serialise(value: unknown): JsonScalar {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object" && "toString" in value) return String(value);
  return String(value);
}
