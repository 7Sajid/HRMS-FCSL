import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { escalateAfterWorkingDays, byLongestWaiting, isOverdue } from "@/lib/escalation";
import { waitingWith } from "@/lib/approval-chain";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { LeaveInbox } from "@/components/approvals/LeaveInbox";
import { RequisitionInbox } from "@/components/approvals/RequisitionInbox";

export const metadata = { title: "Final approvals · FCSL HR" };

/**
 * §5.5 / P5.1 — the last step of every leave application in the company.
 *
 * "The final approval is the only moment leave is actually granted." Until
 * this screen is cleared, an application that a manager and the HR Head have
 * both already agreed to is still not leave: the days have not come off the
 * balance and the applicant has not been told. So the panel is small, used
 * briefly, and used DAILY — and the page says so, because an inbox whose
 * consequences are invisible is an inbox that waits.
 *
 * The decision itself is not implemented here. It is `lib/leave-decide.ts`,
 * the same function the manager's page and the HR Head's inbox call, which is
 * what stops three screens growing three ideas of the same three rules.
 */
export default async function Page() {
  const context = await requireCapability("leave.approveFinal");
  const today = todayInDhaka();

  const [leaveCount, requisitionCount, escalateAfter, elsewhere] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: "PENDING", currentApproverRole: "SUPER_ADMIN" } }),
    prisma.requisition.count({ where: { status: "PENDING", currentApproverRole: "SUPER_ADMIN" } }),
    escalateAfterWorkingDays(),
    // Everything still moving through the chain BELOW this desk. Read-only,
    // and deliberately so — rule 1 is one step at a time, in order, and a
    // Super Admin who could reach down and approve out of turn would make the
    // manager's decision optional.
    //
    // Denied applications are absent, and that is rule 2 rather than an
    // oversight: whoever denies it ends it, and nobody above that point is
    // ever told it existed.
    prisma.leaveRequest.findMany({
      where: { status: "PENDING", currentApproverRole: { not: "SUPER_ADMIN" } },
      include: {
        leaveType: { select: { name: true } },
        days: { select: { lengthDays: true, date: true }, orderBy: { date: "asc" } },
        employee: {
          select: {
            fullName: true,
            employeeId: true,
            branch: { select: { name: true } },
            user: { select: { role: true } },
          },
        },
      },
      orderBy: { appliedAt: "asc" },
      take: 100,
    }),
  ]);

  const total = leaveCount + requisitionCount;
  const stalled = byLongestWaiting(elsewhere, (r) => r.appliedAt, today).filter(({ waited }) =>
    isOverdue(waited, escalateAfter),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Final approvals"
        subtitle={
          total === 0
            ? "Nothing is waiting with you. Every application in the company has been dealt with."
            : `${total} thing${total === 1 ? "" : "s"} waiting. Nothing below is leave yet — granting is what makes it leave.`
        }
      />

      {total > 0 && (
        <NoticeBox>
          {/* Stated on the screen rather than in a manual, because this is the
              one desk where waiting has a cost the person waiting cannot see. */}
          Each of these has already been agreed by everybody below. The days have
          not come off anybody&rsquo;s balance and nobody has been told yet — that
          happens the moment you grant it.
        </NoticeBox>
      )}

      <section className="mb-10 mt-6">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Leave{leaveCount ? ` (${leaveCount})` : ""}
        </h2>
        <LeaveInbox actorRole={context.user.role} actorEmployeeId={context.employeeId} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Requisitions{requisitionCount ? ` (${requisitionCount})` : ""}
        </h2>
        <p className="mb-3 text-xs text-ink-500">
          Only those above the escalation threshold reach here. Below it the HR
          Head&rsquo;s approval is final.
        </p>
        <RequisitionInbox actorRole={context.user.role} />
      </section>

      <section>
        <h2 className="text-sm font-semibold text-ink-900">Still moving through the chain</h2>
        <p className="mb-3 mt-0.5 text-xs text-ink-500">
          {elsewhere.length === 0
            ? "Nothing is in flight anywhere else."
            : `${elsewhere.length} application${elsewhere.length === 1 ? "" : "s"} waiting with somebody below. You cannot decide these from here — each one has to be dealt with in order.`}
        </p>

        {stalled.length > 0 && (
          <div className="mb-3 rounded-lg border border-warn-500/40 bg-warn-50 px-4 py-3 text-sm text-ink-700">
            <strong className="font-medium">
              {stalled.length} {stalled.length === 1 ? "has" : "have"} been waiting longer than{" "}
              {escalateAfter} working day{escalateAfter === 1 ? "" : "s"}.
            </strong>{" "}
            Somebody below has not looked at their inbox.
          </div>
        )}

        {elsewhere.length === 0 ? (
          <EmptyState>Nothing in flight.</EmptyState>
        ) : (
          <Card className="divide-y divide-ink-300/20">
            {byLongestWaiting(elsewhere, (r) => r.appliedAt, today).map(({ item: request, waited }) => {
              const cost = request.days.reduce((sum, d) => sum + Number(d.lengthDays), 0);
              const first = request.days[0]?.date ?? null;
              const last = request.days.at(-1)?.date ?? null;
              return (
                <div key={request.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                  <span className="text-sm font-medium text-ink-900">
                    {request.employee.fullName}
                  </span>
                  <span className="text-xs text-ink-400">
                    {request.employee.employeeId ?? "—"}
                    {request.employee.branch ? ` · ${request.employee.branch.name}` : ""}
                  </span>
                  <span className="text-sm text-ink-700">
                    {request.leaveType.name}, {cost} day{cost === 1 ? "" : "s"} —{" "}
                    {formatDate(first)}
                    {last && last !== first ? ` to ${formatDate(last)}` : ""}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    {isOverdue(waited, escalateAfter) && (
                      <Badge tone="warn">
                        {waited} working day{waited === 1 ? "" : "s"}
                      </Badge>
                    )}
                    <span className="text-xs text-ink-500">
                      {waitingWith(request.currentApproverRole, request.employee.user.role, "other")}
                    </span>
                  </span>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <p className="mt-8 text-xs text-ink-400">
        Every decision made here, and every one made below it, is in{" "}
        <Link href="/admin/audit" className="text-brand-500 hover:underline">
          the permanent record
        </Link>
        .
      </p>
    </main>
  );
}
