import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { outcomeLabel, outcomeTone } from "@/lib/showcause";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { IssueShowCauseForm } from "@/components/compliance/IssueForm";

export const metadata = { title: "Compliance · FCSL HR" };

/** §6.5 — the disciplinary process, inside the software instead of on paper. */
export default async function Page() {
  await requireCapability("showcause.issue");

  const [open, closed, people] = await Promise.all([
    prisma.showCause.findMany({
      where: { closedAt: null },
      include: { employee: { select: { fullName: true, employeeId: true } } },
      orderBy: { issuedAt: "asc" },
    }),
    prisma.showCause.findMany({
      where: { closedAt: { not: null } },
      include: { employee: { select: { fullName: true, employeeId: true } } },
      orderBy: { closedAt: "desc" },
      take: 25,
    }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED" },
      select: { id: true, fullName: true, employeeId: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Compliance"
        subtitle="Show-cause letters, replies and outcomes — kept together in the person's file, permanently."
      />

      <Card className="mb-8 border-brand-200 bg-brand-50/30 p-5">
        <p className="text-sm text-ink-700">
          {/* §6.5, said where somebody is about to act on it. */}
          <strong className="font-medium">These are the most private records in the system.</strong>{" "}
          A show-cause is visible to you, to the person concerned, and to nobody else — not their
          manager, unless you choose to include them. Every single time one is opened, the system
          records who opened it.
        </p>
      </Card>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Open{open.length ? ` (${open.length})` : ""}
        </h2>
        {open.length === 0 ? (
          <EmptyState>Nothing open.</EmptyState>
        ) : (
          <div className="space-y-3">
            {open.map((showCause) => (
              <Card key={showCause.id} className="flex flex-wrap items-center gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink-900">{showCause.employee.fullName}</p>
                    <span className="text-xs text-ink-400">{showCause.employee.employeeId}</span>
                    {showCause.repliedAt ? (
                      <Badge tone="brand">Replied</Badge>
                    ) : (
                      <Badge tone="warn">Awaiting their reply</Badge>
                    )}
                    {showCause.visibleToManager && <Badge tone="neutral">Manager can see it</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-700">{showCause.subject}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    Issued {formatDate(showCause.issuedAt)} by {showCause.issuedByName}
                  </p>
                </div>
                <Link
                  href={`/hr/compliance/${showCause.id}`}
                  className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Open
                </Link>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Issue a show-cause</h2>
        <Card className="p-6">
          <IssueShowCauseForm
            people={people.map((p) => ({
              id: p.id,
              name: `${p.fullName}${p.employeeId ? ` · ${p.employeeId}` : ""}`,
            }))}
          />
        </Card>
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Closed</h2>
          <Card className="divide-y divide-ink-300/20">
            {closed.map((showCause) => (
              <Link
                key={showCause.id}
                href={`/hr/compliance/${showCause.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm hover:bg-surface"
              >
                <span className="flex-1">
                  <span className="text-ink-900">{showCause.employee.fullName}</span>
                  <span className="ml-2 text-ink-500">{showCause.subject}</span>
                </span>
                <span className="text-xs text-ink-400">{formatDate(showCause.closedAt)}</span>
                <Badge tone={outcomeTone(showCause.outcome)}>{outcomeLabel(showCause.outcome)}</Badge>
              </Link>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
