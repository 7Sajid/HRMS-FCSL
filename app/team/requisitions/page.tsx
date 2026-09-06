import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { requisitionLabel } from "@/lib/requisitions";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";
import { RaiseRequisitionForm } from "@/components/requisitions/RaiseForm";

export const metadata = { title: "Requisitions · FCSL HR" };

const WAITING: Record<string, string> = {
  HR_HEAD: "Waiting with the HR Head",
  SUPER_ADMIN: "Waiting with the Super Admin",
};

export default async function Page() {
  const context = await requireCapability("requisitions.raise");

  const [mine, setting] = await Promise.all([
    prisma.requisition.findMany({
      where: { raisedById: context.employeeId ?? "__none__" },
      include: { approvals: { orderBy: { step: "asc" } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.setting.findUnique({ where: { key: "requisition.escalationThreshold" } }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Requisitions"
        subtitle="Ask the company for supplies, equipment, money or new staff — and watch it move."
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
                </Td>
              </tr>
            );
          })}
        </Tbody>
      </TableShell>
    </main>
  );
}
