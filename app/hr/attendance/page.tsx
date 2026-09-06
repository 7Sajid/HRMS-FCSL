import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDateTime, formatMonth, todayInDhaka } from "@/lib/dates";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";

export const metadata = { title: "Attendance · FCSL HR" };

/**
 * §6.3 — HR checks the sheets against leave records, corrects with a reason
 * recorded, then publishes the month.
 *
 * "If a branch has not submitted by the deadline, HR sees it on a list of
 * missing branches" — which is the whole point of this screen existing rather
 * than HR chasing by email.
 */
export default async function Page() {
  await requireCapability("attendance.verify");
  const today = todayInDhaka();

  // The month being reported on is the one that has just finished.
  const reporting = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const year = reporting.getUTCFullYear();
  const month = reporting.getUTCMonth() + 1;

  const [branches, sheets, deadline] = await Promise.all([
    prisma.branch.findMany({ where: { closedOn: null }, orderBy: { name: "asc" } }),
    prisma.attendanceSheet.findMany({
      where: { year, month },
      include: { branch: true, entries: { select: { id: true } } },
    }),
    prisma.setting.findUnique({ where: { key: "attendance.deadlineDayOfMonth" } }),
  ]);

  const recent = await prisma.attendanceSheet.findMany({
    where: { OR: [{ year: { not: year } }, { month: { not: month } }] },
    include: { branch: true },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    take: 12,
  });

  const byBranch = new Map(sheets.map((s) => [s.branchId, s]));
  const missing = branches.filter((b) => !byBranch.has(b.id) || byBranch.get(b.id)!.status === "OPEN");

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Attendance"
        subtitle={`${formatMonth(year, month)} — check each branch against leave, correct with a reason, then publish.`}
      />

      {missing.length > 0 && (
        <Card className="mb-6 border-warn-500/50 bg-warn-50/30 p-5">
          <h2 className="text-sm font-medium text-ink-900">
            {missing.length} branch{missing.length === 1 ? " has" : "es have"} not submitted
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Due by day {deadline?.value ?? 5} of the following month.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-ink-700">
            {missing.map((branch) => (
              <li key={branch.id}>{branch.name}</li>
            ))}
          </ul>
        </Card>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">{formatMonth(year, month)}</h2>
        {sheets.filter((s) => s.status !== "OPEN").length === 0 ? (
          <EmptyState>No branch has submitted this month yet.</EmptyState>
        ) : (
          <div className="space-y-3">
            {sheets
              .filter((s) => s.status !== "OPEN")
              .map((sheet) => (
                <Card key={sheet.id} className="flex flex-wrap items-center gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink-900">{sheet.branch.name}</p>
                      {sheet.status === "SUBMITTED" && <Badge tone="warn">Waiting for you</Badge>}
                      {sheet.status === "PUBLISHED" && <Badge tone="success">Published</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {sheet.entries.length} entries · submitted by {sheet.submittedByName} on{" "}
                      {formatDateTime(sheet.submittedAt)}
                      {sheet.publishedAt ? ` · published ${formatDateTime(sheet.publishedAt)}` : ""}
                    </p>
                  </div>
                  <Link
                    href={`/hr/attendance/${sheet.id}`}
                    className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    {sheet.status === "SUBMITTED" ? "Check it" : "Open"}
                  </Link>
                </Card>
              ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Earlier months</h2>
          <Card className="divide-y divide-ink-300/20">
            {recent.map((sheet) => (
              <Link
                key={sheet.id}
                href={`/hr/attendance/${sheet.id}`}
                className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-surface"
              >
                <span className="flex-1 text-ink-900">
                  {sheet.branch.name} — {formatMonth(sheet.year, sheet.month)}
                </span>
                {sheet.status === "PUBLISHED" ? (
                  <Badge tone="success">Published</Badge>
                ) : sheet.status === "SUBMITTED" ? (
                  <Badge tone="warn">Waiting</Badge>
                ) : (
                  <Badge tone="neutral">Open</Badge>
                )}
              </Link>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
