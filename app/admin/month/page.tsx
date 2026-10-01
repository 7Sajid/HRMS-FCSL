import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatMonth, todayInDhaka } from "@/lib/dates";
import { monthlySummary, type SummaryScope } from "@/lib/reports";
import { Card, EmptyState, PageHeader, Stat } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";

export const metadata = { title: "The month · FCSL HR" };

/**
 * §6.10, as FCSL extended it on 2 October 2026: the owner's month-end view —
 * "how many people took leave this month, how many is paid, how many is unpaid,
 * ratio against 30 days."
 *
 * His alone (`reports.monthlySummary`). The HR Head keeps the reports that go
 * with the work of publishing attendance; this is the question asked after the
 * month is done.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; by?: string; id?: string }>;
}) {
  await requireCapability("reports.monthlySummary");
  const params = await searchParams;
  const today = todayInDhaka();

  // Defaults to LAST month, because this is the month-end question and the
  // month you are standing in is never closed.
  const previous = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const picked = /^\d{4}-\d{2}$/.test(params.m ?? "") ? params.m! : null;
  const year = picked ? Number(picked.slice(0, 4)) : previous.getUTCFullYear();
  const month = picked ? Number(picked.slice(5, 7)) : previous.getUTCMonth() + 1;
  const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;

  const [divisions, branches, departments] = await Promise.all([
    prisma.division.findMany({ where: { retiredAt: null }, orderBy: { name: "asc" } }),
    prisma.branch.findMany({ where: { closedOn: null }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { retiredAt: null }, orderBy: { name: "asc" } }),
  ]);

  // The filter is read from the URL and checked against what exists, so a
  // hand-typed id cannot widen the scope or name a thing that is gone.
  const by = params.by ?? "company";
  const known =
    by === "division"
      ? divisions.find((d) => d.id === params.id)
      : by === "branch"
        ? branches.find((b) => b.id === params.id)
        : by === "department"
          ? departments.find((d) => d.id === params.id)
          : null;
  const scope: SummaryScope =
    known && (by === "division" || by === "branch" || by === "department")
      ? { kind: by, id: known.id }
      : { kind: "company" };
  const scopeLabel = known ? known.name : "The whole company";

  const summary = await monthlySummary(year, month, scope);
  const link = (next: { m?: string; by?: string; id?: string }) => {
    const query = new URLSearchParams({
      m: next.m ?? iso(year, month),
      ...(next.by && next.by !== "company" ? { by: next.by, id: next.id ?? "" } : {}),
    });
    return `/admin/month?${query.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        eyebrow={scopeLabel.toUpperCase()}
        title={`The month — ${formatMonth(year, month)}`}
        subtitle={`Leave and absence against ${summary.headcount} people over ${summary.month.days} days.`}
        actions={
          <div className="flex gap-1">
            <Link
              href={link({ m: iso(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1), by, id: params.id })}
              className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm hover:bg-surface"
            >
              ←
            </Link>
            <Link
              href={link({ m: iso(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1), by, id: params.id })}
              className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm hover:bg-surface"
            >
              →
            </Link>
          </div>
        }
      />

      {/* FCSL: the summary is read once every branch has published. It is shown
          either way, marked, so an unpublished branch is something he can chase
          rather than a blank screen. */}
      {!summary.closed && (
        <div className="mb-6">
          <NoticeBox tone="warn">
            <p>
              <strong className="font-medium">These figures are provisional.</strong>{" "}
              {summary.publishedBranches} of {summary.openBranches} branch
              {summary.openBranches === 1 ? " has" : "es have"} published branch attendance for{" "}
              {formatMonth(year, month)}, so the absence figure is incomplete. Leave is complete
              either way — it does not wait on a branch.
            </p>
            <p className="mt-1 text-xs">Still to publish: {summary.awaiting.join(", ")}</p>
          </NoticeBox>
        </div>
      )}
      {summary.closed && summary.openBranches > 0 && (
        <div className="mb-6">
          <NoticeBox tone="success">
            <p>
              Every branch has published branch attendance for {formatMonth(year, month)}. This
              month is closed.
            </p>
          </NoticeBox>
        </div>
      )}

      <Filter divisions={divisions} branches={branches} departments={departments} by={by} id={params.id} month={iso(year, month)} />

      <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People" value={summary.headcount} big />
        <Stat
          label="Took leave"
          value={summary.tookLeave}
          big
          note={`${summary.tookNone} took none`}
        />
        <Stat
          label="Leave ratio"
          value={`${summary.leaveRatio}%`}
          big
          tone={summary.leaveRatio > 10 ? "warn" : "neutral"}
          note={`${summary.leaveDays} of ${summary.personDays} person-days`}
        />
        <Stat
          label="Absence ratio"
          value={`${summary.absence.ratio}%`}
          big
          tone={summary.absence.ratio > 2 ? "danger" : "neutral"}
          note={`${summary.absence.days} day${summary.absence.days === 1 ? "" : "s"}, ${summary.absence.people} people`}
        />
      </section>

      <section className="mb-8 grid gap-3 sm:grid-cols-2">
        <Stat
          label="Paid leave"
          value={`${summary.paid.people} people`}
          note={`${summary.paid.days} day${summary.paid.days === 1 ? "" : "s"}`}
          tone="success"
        />
        <Stat
          label="Unpaid leave"
          value={`${summary.unpaid.people} people`}
          note={`${summary.unpaid.days} day${summary.unpaid.days === 1 ? "" : "s"}`}
          tone="warn"
        />
      </section>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Bars
          title="How much leave each person took"
          empty="Nobody took leave this month."
          rows={summary.distribution.map((d) => ({
            name: `${d.days} day${d.days === 1 ? "" : "s"}`,
            value: d.people,
            suffix: `${d.people} ${d.people === 1 ? "person" : "people"}`,
          }))}
        />
        <Bars
          title="By kind of leave"
          empty="No leave of any kind this month."
          rows={summary.byType.map((t) => ({
            name: t.name,
            value: t.days,
            suffix: `${t.days} day${t.days === 1 ? "" : "s"} · ${t.people} ${t.people === 1 ? "person" : "people"}`,
          }))}
        />
      </div>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-ink-900">
          Every person who took leave, most first
        </h2>
        <p className="mb-3 text-xs text-ink-500">
          {summary.peopleTotal > summary.people.length
            ? `The ${summary.people.length} who took the most, of ${summary.peopleTotal}.`
            : `All ${summary.peopleTotal} of them.`}{" "}
          Ratio is their days against the {summary.month.days} days of the month.
        </p>
        <TableShell>
          <Thead>
            <tr>
              <Th>Name</Th>
              <Th>Branch</Th>
              <Th>Department</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Unpaid</Th>
              <Th className="text-right">Days</Th>
              <Th className="text-right">Ratio</Th>
            </tr>
          </Thead>
          <Tbody>
            {summary.people.length === 0 && (
              <TableEmpty colSpan={7}>Nobody in this view took leave in {formatMonth(year, month)}.</TableEmpty>
            )}
            {summary.people.map((person) => (
              <tr key={person.id}>
                <Td>
                  {person.name}
                  {person.employeeId && (
                    <span className="block text-xs text-ink-400">{person.employeeId}</span>
                  )}
                </Td>
                <Td>{person.branch}</Td>
                <Td>{person.department}</Td>
                <Td className="text-right tabular">{person.paidDays || "—"}</Td>
                <Td className="text-right tabular">
                  {person.unpaidDays ? <Badge tone="warn">{person.unpaidDays}</Badge> : "—"}
                </Td>
                <Td className="text-right tabular">{person.days}</Td>
                <Td className="text-right tabular">{person.ratio}%</Td>
              </tr>
            ))}
          </Tbody>
        </TableShell>
      </section>
    </main>
  );
}

/**
 * The filter FCSL asked for: the whole company, a division, a branch or a
 * department. Plain links rather than a form, so every view has its own address
 * that can be bookmarked or sent to somebody.
 */
function Filter({
  divisions,
  branches,
  departments,
  by,
  id,
  month,
}: {
  divisions: { id: string; name: string }[];
  branches: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  by: string;
  id?: string;
  month: string;
}) {
  const href = (nextBy: string, nextId?: string) =>
    `/admin/month?${new URLSearchParams({ m: month, ...(nextBy === "company" ? {} : { by: nextBy, id: nextId ?? "" }) }).toString()}`;

  const group = (label: string, kind: string, rows: { id: string; name: string }[]) =>
    rows.length === 0 ? null : (
      <div key={kind}>
        <p className="mb-1 text-xs font-semibold tracking-widest text-ink-400">
          {label.toUpperCase()}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {rows.map((row) => (
            <Link
              key={row.id}
              href={href(kind, row.id)}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                by === kind && id === row.id
                  ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
                  : "border-ink-300/60 bg-white text-ink-700 hover:bg-surface"
              }`}
            >
              {row.name}
            </Link>
          ))}
        </div>
      </div>
    );

  return (
    <Card className="mb-8 space-y-3 p-5">
      <Link
        href={href("company")}
        className={`inline-block rounded-lg border px-2.5 py-1 text-xs ${
          by === "company"
            ? "border-brand-500 bg-brand-50 font-medium text-brand-700"
            : "border-ink-300/60 bg-white text-ink-700 hover:bg-surface"
        }`}
      >
        The whole company
      </Link>
      {group("Division", "division", divisions)}
      {group("Branch", "branch", branches)}
      {group("Department", "department", departments)}
    </Card>
  );
}

/**
 * Bars drawn in CSS rather than with a charting library. Twenty-one grades and
 * six departments do not need 80KB of JavaScript, and a div with a width reads
 * the same to a screen reader as the number beside it.
 */
function Bars({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { name: string; value: number; suffix: string }[];
  empty: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
        {title.toUpperCase()}
      </h3>
      {rows.length === 0 ? (
        <EmptyState>{empty}</EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-ink-900">{row.name}</span>
                <span className="shrink-0 text-xs text-ink-500">{row.suffix}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink-300/25">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
