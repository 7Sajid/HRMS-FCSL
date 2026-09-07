import type { Prisma } from "@prisma/client";
import { ACTION_GROUPS, type AuditAction } from "./audit";
import { dhakaRange, fromISODate } from "./dates";

/**
 * Reading the permanent record (§6.10, P4.7).
 *
 * The screen and the CSV export ask the same question of the database through
 * this file. Written twice they would drift, and the drift would be invisible:
 * an export that quietly returns a different set of rows from the one on
 * screen is worse than no export, because the person who ran it will swear the
 * two matched.
 *
 * There is no write path here and there cannot be one — Postgres refuses
 * UPDATE, DELETE and TRUNCATE on the table.
 */

export type AuditFilters = {
  /** A group label from ACTION_GROUPS, or "" for all. */
  group?: string;
  /** One exact action name, which narrows further within a group. */
  action?: string;
  /** Free text over the actor's name, the target label and the target id. */
  q?: string;
  /** Everything this one person did — used from an employee's file. */
  actorId?: string;
  /** Everything that happened to one thing. */
  targetType?: string;
  targetId?: string;
  /** Calendar dates in Dhaka, inclusive at both ends. */
  from?: string;
  to?: string;
};

export function groupNamed(label: string | undefined): { label: string; actions: AuditAction[] } | null {
  if (!label) return null;
  return ACTION_GROUPS.find((g) => g.label === label) ?? null;
}

export function auditWhere(filters: AuditFilters): Prisma.AuditEventWhereInput {
  const group = groupNamed(filters.group);
  const q = (filters.q ?? "").trim();

  // Both ends are inclusive calendar days in Dhaka. `dhakaRange` turns them
  // into an instant range, so "to = today" includes everything that happened
  // today rather than stopping at midnight UTC — six hours of missing rows,
  // and always the most recent six.
  const from = fromISODate(filters.from);
  const to = fromISODate(filters.to);
  let createdAt: Prisma.DateTimeFilter | undefined;
  if (from && to) {
    const range = dhakaRange(from, to);
    createdAt = { gte: range.gte, lt: range.lt };
  } else if (from) {
    createdAt = { gte: dhakaRange(from, from).gte };
  } else if (to) {
    createdAt = { lt: dhakaRange(to, to).lt };
  }

  return {
    AND: [
      // An exact action wins over the group it belongs to, so the chips and
      // the dropdown can both be set without contradicting each other.
      filters.action ? { action: filters.action } : group ? { action: { in: group.actions } } : {},
      filters.actorId ? { actorId: filters.actorId } : {},
      filters.targetType ? { targetType: filters.targetType } : {},
      filters.targetId ? { targetId: filters.targetId } : {},
      createdAt ? { createdAt } : {},
      q
        ? {
            OR: [
              { actorName: { contains: q, mode: "insensitive" } },
              { targetLabel: { contains: q, mode: "insensitive" } },
              { targetId: { equals: q } },
              { ip: { equals: q } },
            ],
          }
        : {},
    ],
  };
}

/** Only the keys this screen understands, so a stray query string is ignored. */
export function readFilters(params: {
  get(key: string): string | null;
}): AuditFilters;
export function readFilters(params: Record<string, string | undefined>): AuditFilters;
export function readFilters(
  params: Record<string, string | undefined> | { get(key: string): string | null },
): AuditFilters {
  const read = (key: string): string =>
    typeof (params as { get?: unknown }).get === "function"
      ? ((params as { get(key: string): string | null }).get(key) ?? "")
      : ((params as Record<string, string | undefined>)[key] ?? "");

  return {
    group: read("group"),
    action: read("action"),
    q: read("q"),
    actorId: read("actorId"),
    targetType: read("targetType"),
    targetId: read("targetId"),
    from: read("from"),
    to: read("to"),
  };
}

/**
 * A one-line summary of the `detail` column.
 *
 * The log holds before/after pairs, reasons and counts. A person scanning the
 * list wants the reason and the changed field names, not a wall of JSON — the
 * whole object is still one click away on the row.
 */
export function summariseDetail(detail: unknown): string {
  if (!detail || typeof detail !== "object") return "";
  const record = detail as Record<string, unknown>;

  const changes = record.changes;
  if (changes && typeof changes === "object") {
    const fields = Object.keys(changes as Record<string, unknown>);
    if (fields.length) return `Changed ${fields.join(", ")}`;
  }

  // The spec asks that nobody is ever told something without the reason (§6),
  // so where a reason exists it is the most useful thing on the row.
  for (const key of ["reason", "rejectionReason", "denialReason", "note"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const parts = Object.entries(record)
    .filter(([, value]) => value !== null && typeof value !== "object")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.join(" · ");
}
