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

  // §6.4 ends with somebody recording that the thing arrived. Whoever approves
  // requisitions does it here — there is no Admin or Accounts role in this
  // system, and an approved requisition is not in anybody's inbox any more, so
  // without this list nothing could reach the last step at all.
  const canClose = can(context.viewer, "requisitions.approve");
  const [mine, setting, awaitingDelivery] = await Promise.all([
    prisma.requisition.findMany({
      where: { raisedById: context.employeeId ?? "__none__" },
      include: { approvals: { orderBy: { step: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.setting.findUnique({ where: { key: "requisition.escalationThreshold" } }),
    canClose
      ? prisma.requisition.findMany({
          where: { status: "APPROVED" },
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
        <RaiseRequisitionForm threshold={Number(setting?.value ?? 50000)} />
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

      {canClose && awaitingDelivery.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-ink-900">
            Approved, waiting to be delivered
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
