import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { ACTION_GROUPS, actionLabel } from "@/lib/audit";
import { auditWhere, readFilters, summariseDetail } from "@/lib/audit-query";
import { formatDateTime } from "@/lib/dates";
import { ROLE_LABELS } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/Card";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";
import { AuditFilters } from "@/components/audit/AuditFilters";

export const metadata = { title: "Permanent record · FCSL HR" };

const PAGE_SIZE = 50;

type Props = { searchParams: Promise<Record<string, string | undefined>> };

/**
 * §6.10 / P4.7 — the permanent record viewer.
 *
 * Read-only, and read-only is all it can ever be. There is no action file
 * behind this screen and no route that writes to the table; underneath, a
 * Postgres trigger refuses UPDATE, DELETE and TRUNCATE, so the claim survives
 * somebody with a psql prompt and the database password.
 *
 * The HR Head and the Super Admin both reach it. Neither can change a line of
 * it, which is the only arrangement under which the log is worth keeping.
 */
export default async function Page({ searchParams }: Props) {
  const context = await requireCapability("audit.read");
  const params = await searchParams;
  const filters = readFilters(params);
  const page = Math.max(1, Math.min(1000, Number(params.page) || 1));

  // One row beyond the page, which answers "is there a next page" without
  // counting a table that grows for ever and is never pruned. A `count(*)`
  // here is the query that is fast on the demo and slow in year three.
  const rows = await prisma.auditEvent.findMany({
    where: auditWhere(filters),
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });
  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  const query = new URLSearchParams(
    Object.entries(params).filter(([key, value]) => value && key !== "page") as [string, string][],
  );

  const groups = ACTION_GROUPS.map((group) => ({
    label: group.label,
    actions: group.actions.map((action) => ({ value: action, label: actionLabel(action) })),
  }));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="The permanent record"
        subtitle="Every action that changed something, or revealed somebody's private information. Nothing here can be edited or deleted — not by HR, not by the Super Admin, not by whoever built this."
        actions={
          <a
            href={`/api/export?type=audit&${query.toString()}`}
            className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            Export to a spreadsheet
          </a>
        }
      />

      <AuditFilters groups={groups} current={params} />

      <TableShell>
        <Thead>
          <tr>
            <Th>When</Th>
            <Th>Who</Th>
            <Th>What happened</Th>
            <Th>To what</Th>
            <Th>Detail</Th>
          </tr>
        </Thead>
        <Tbody>
          {visible.length === 0 && (
            <TableEmpty colSpan={5}>Nothing was recorded that matches those filters.</TableEmpty>
          )}
          {visible.map((row) => {
            const summary = summariseDetail(row.detail);
            return (
              <tr key={row.id}>
                <Td className="whitespace-nowrap tabular text-ink-500">
                  {formatDateTime(row.createdAt)}
                </Td>
                <Td>
                  <span className="text-ink-900">{row.actorName}</span>
                  {row.actorRole && (
                    <span className="ml-2 text-xs text-ink-400">{roleLabel(row.actorRole)}</span>
                  )}
                  {row.ip && <div className="text-xs text-ink-400">{row.ip}</div>}
                </Td>
                <Td>{actionLabel(row.action)}</Td>
                <Td className="text-ink-700">{row.targetLabel || "—"}</Td>
                <Td className="text-ink-500">
                  {row.detail ? (
                    <details>
                      <summary className="cursor-pointer text-xs">
                        {summary || "Show what was recorded"}
                      </summary>
                      <pre className="mt-2 max-w-md overflow-x-auto whitespace-pre-wrap rounded-lg bg-surface p-2 text-xs text-ink-700">
                        {JSON.stringify(row.detail, null, 2)}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-xs">—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Tbody>
      </TableShell>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-ink-500">
          Page {page}
          {visible.length > 0 && ` · ${visible.length} ${visible.length === 1 ? "line" : "lines"}`}
        </span>
        <div className="flex gap-2">
          {page > 1 && <PageLink params={params} page={page - 1} label="Newer" />}
          {hasNext && <PageLink params={params} page={page + 1} label="Older" />}
        </div>
      </div>

      <p className="mt-6 text-xs text-ink-400">
        {/* The viewer opening the log is itself a fact worth stating on the page:
            people behave differently when they know the reading is recorded. */}
        Opening a document or a show-cause file is recorded here too, with the
        name of whoever opened it. Signed in as {context.employee?.fullName ?? context.user.email}.
      </p>
    </main>
  );
}

/**
 * A role recorded in 2026 may not be a role the software still has. The log is
 * append-only, so the name is rendered as written rather than forced through
 * the current enum.
 */
function roleLabel(role: string): string {
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;
}

function PageLink({
  params,
  page,
  label,
}: {
  params: Record<string, string | undefined>;
  page: number;
  label: string;
}) {
  const query = new URLSearchParams(
    Object.entries({ ...params, page: String(page) }).filter(([, v]) => v) as [string, string][],
  );
  return (
    <Link
      href={`/admin/audit?${query.toString()}`}
      className="rounded-lg border border-ink-300/60 bg-white px-3 py-1.5 text-sm hover:bg-surface"
    >
      {label}
    </Link>
  );
}
