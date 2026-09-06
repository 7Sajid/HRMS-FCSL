import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { PageHeader } from "@/components/ui/Card";
import { LeaveInbox } from "@/components/approvals/LeaveInbox";
import { RequisitionInbox } from "@/components/approvals/RequisitionInbox";

export const metadata = { title: "Approvals · FCSL HR" };

/**
 * §5.4 page 9 — "One inbox holding everything waiting."
 *
 * "The single most common failure of an approval system is that requests sit
 * unseen in a screen nobody opens. One inbox, one counter on the menu, one
 * email digest each morning." So leave and requisitions are on the same page,
 * not two tabs somebody has to remember to check.
 */
export default async function Page() {
  const context = await requireCapability("requisitions.approve");

  const [leaveCount, requisitionCount] = await Promise.all([
    prisma.leaveRequest.count({
      where: { status: "PENDING", currentApproverRole: context.user.role },
    }),
    prisma.requisition.count({
      where: { status: "PENDING", currentApproverRole: context.user.role },
    }),
  ]);
  const total = leaveCount + requisitionCount;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Approvals"
        subtitle={
          total === 0
            ? "Nothing is waiting with you."
            : `${total} thing${total === 1 ? "" : "s"} waiting. Anything older than three working days is amber.`
        }
      />

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Leave{leaveCount ? ` (${leaveCount})` : ""}
        </h2>
        <LeaveInbox actorRole={context.user.role} actorEmployeeId={context.employeeId} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Requisitions{requisitionCount ? ` (${requisitionCount})` : ""}
        </h2>
        <RequisitionInbox actorRole={context.user.role} />
      </section>
    </main>
  );
}
