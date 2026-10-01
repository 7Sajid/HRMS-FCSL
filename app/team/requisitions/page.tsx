import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { requisitionLabel } from "@/lib/requisitions";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";
import { RaiseRequisitionForm } from "@/components/requisitions/RaiseForm";
import { MarkDelivered, WithdrawRequisition } from "@/components/requisitions/RequisitionActions";
import { can } from "@/lib/permissions";

export const metadata = { title: "Requisitions · FCSL HR" };

const WAITING: Record<string, string> = {
  HR_HEAD: "Waiting with the HR Head",
  SUPER_ADMIN: "Waiting with the Super Admin",
};

export default async function Page() {
  const context = await requireCapability("requisitions.raise");

  // §6.4 ends with somebody recording that the thing arrived.
  //
  // Since 1 October 2026 that somebody is normally the head of the department
  // the HR Head sent it to — IT handed over the laptop, Accounts paid the
  // money. Whoever approves requisitions still sees all of them and can close
  // one, because a department head on leave should not strand a delivered
  // laptop in a list nobody is looking at.
  const canClose = can(context.viewer, "requisitions.approve");
  const headed = await prisma.department.findMany({
    where: { headId: context.employeeId ?? "__none__" },
    select: { id: true, name: true },
  });
  const [mine, departments, awaitingDelivery] = await Promise.all([
    prisma.requisition.findMany({
      where: { raisedById: context.employeeId ?? "__none__" },
      include: { approvals: { orderBy: { step: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    // The HR Head's own requisition skips their desk, so they say who will
    // action it here rather than at an approval step they never see.
    context.user.role === "HR_HEAD"
      ? prisma.department.findMany({
          where: { retiredAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [],
    canClose || headed.length
      ? prisma.requisition.findMany({
          where: canClose
            ? { status: "APPROVED" }
            : { status: "APPROVED", actionDepartmentId: { in: headed.map((d) => d.id) } },
          orderBy: { decidedAt: "asc" },
          take: 100,
        })
      : [],
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Requisitions"
        subtitle="Ask the company for supplies, equipment, money or new employees — and watch it move."
      />

      <Card className="mb-8 p-6">
        <RaiseRequisitionForm departments={departments} />
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-ink-900">What I have raised</h2>
      <TableShell>
        <Thead>
          <tr>
            <Th>Type</Th>
            <Th>Raised</Th>
            <Th className="text-right">Amount</Th>
            <Th>Where it is</Th>
          </tr>
        </Thead>
        <Tbody>
          {mine.length === 0 && (
            <TableEmpty colSpan={4}>You have not raised anything yet.</TableEmpty>
          )}
          {mine.map((requisition) => {
            const denial = requisition.approvals.find((a) => a.decision === "DENIED");
            return (
              <tr key={requisition.id}>
                <Td>{requisitionLabel(requisition.type)}</Td>
                <Td className="whitespace-nowrap">{formatDate(requisition.createdAt)}</Td>
                <Td className="text-right tabular">
                  {requisition.amount ? `৳${Number(requisition.amount).toLocaleString("en-BD")}` : "—"}
                </Td>
                <Td>
                  {requisition.status === "PENDING" && (
                    <span className="text-ink-700">
                      {WAITING[requisition.currentApproverRole ?? ""] ?? "Waiting"}
                      {requisition.approvals.length > 0 && (
                        <span className="block text-xs text-ink-400">
                          Approved by {requisition.approvals.map((a) => a.approverName).join(", ")}
                        </span>
                      )}
                    </span>
                  )}
                  {requisition.status === "APPROVED" && <Badge tone="success">Approved</Badge>}
                  {requisition.status === "FULFILLED" && <Badge tone="success">Delivered</Badge>}
                  {requisition.status === "DENIED" && (
                    <span>
                      <Badge tone="danger">Denied</Badge>
                      {denial && (
                        <span className="mt-1 block text-xs text-ink-500">
                          {denial.approverName}: {denial.reason}
                        </span>
                      )}
                    </span>
                  )}
                  {requisition.status === "WITHDRAWN" && <Badge tone="neutral">Withdrawn</Badge>}
                  {requisition.status === "PENDING" && (
                    <span className="mt-1 block">
                      <WithdrawRequisition id={requisition.id} />
                    </span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Tbody>
      </TableShell>

      {awaitingDelivery.length > 0 && (
        <section className="mt-8" id="to-action">
          <h2 className="mb-1 text-sm font-semibold text-ink-900">
            {canClose ? "Approved, waiting to be delivered" : "Approved — waiting for your department"}
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            §6.4 ends here — record what arrived, so the register says what was actually supplied
            and not only what was agreed.
          </p>
          <Card className="divide-y divide-ink-300/20">
            {awaitingDelivery.map((requisition) => (
              <div
                key={requisition.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm text-ink-900">
                    {requisitionLabel(requisition.type)} — {requisition.raisedByName}
                  </p>
                  <p className="text-xs text-ink-500">
                    Approved {requisition.decidedAt ? formatDate(requisition.decidedAt) : "—"}
                    {requisition.amount
                      ? ` · ৳${Number(requisition.amount).toLocaleString("en-BD")}`
                      : ""}
                    {requisition.actionDepartmentName ? ` · ${requisition.actionDepartmentName}` : ""}
                  </p>
                </div>
                <MarkDelivered id={requisition.id} />
              </div>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
