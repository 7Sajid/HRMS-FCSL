import { prisma } from "@/lib/db";
import { formatDate, todayInDhaka, workingDaysSince } from "@/lib/dates";
import { requisitionLabel, requisitionSpec } from "@/lib/requisitions";
import { Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { DecideRequisition } from "./DecideRequisition";
import type { Role } from "@prisma/client";

export async function RequisitionInbox({ actorRole }: { actorRole: Role }) {
  const [requisitions, setting] = await Promise.all([
    prisma.requisition.findMany({
      where: { status: "PENDING", currentApproverRole: actorRole },
      include: {
        approvals: { orderBy: { step: "asc" } },
        raisedBy: { include: { branch: true, designation: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.setting.findUnique({ where: { key: "requisition.escalationThreshold" } }),
  ]);

  if (!requisitions.length) return <EmptyState>No requisitions are waiting with you.</EmptyState>;

  const threshold = Number(setting?.value ?? 50000);
  const today = todayInDhaka();

  return (
    <div className="space-y-3">
      {requisitions.map((requisition) => {
        const waited = workingDaysSince(requisition.createdAt, new Set(), [5, 6], today);
        const overdue = waited >= 3;
        const amount = requisition.amount ? Number(requisition.amount) : null;
        const spec = requisitionSpec(requisition.type);
        const details = requisition.details as Record<string, string>;

        return (
          <Card
            key={requisition.id}
            className={`p-5 ${overdue ? "border-warn-500/50 bg-warn-50/30" : ""}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink-900">
                    {requisitionLabel(requisition.type)}
                  </p>
                  {amount !== null && (
                    <span className="tabular text-sm text-ink-900">
                      ৳{amount.toLocaleString("en-BD")}
                    </span>
                  )}
                  {amount !== null && amount > threshold && (
                    <Badge tone="warn">Goes on to the Super Admin</Badge>
                  )}
                  {overdue && <Badge tone="warn">Waiting {waited} working days</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  {requisition.raisedByName}
                  {requisition.raisedBy.designation ? ` · ${requisition.raisedBy.designation.name}` : ""}
                  {requisition.raisedBy.branch ? ` · ${requisition.raisedBy.branch.name}` : ""} ·{" "}
                  {formatDate(requisition.createdAt)}
                </p>

                <dl className="mt-3 space-y-1 text-sm">
                  {spec?.fields.map((field) =>
                    details[field.name] ? (
                      <div key={field.name} className="flex gap-2">
                        <dt className="text-xs uppercase tracking-wide text-ink-400">
                          {field.label}
                        </dt>
                        <dd className="text-ink-900">{details[field.name]}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>

                {requisition.approvals.length > 0 && (
                  <p className="mt-3 text-xs text-ink-500">
                    Already approved by{" "}
                    {requisition.approvals.map((a) => `${a.approverName} (${a.approverRole})`).join(", ")}
                  </p>
                )}
                {spec && <p className="mt-2 text-xs text-ink-400">{spec.endsWith}</p>}
              </div>

              <DecideRequisition
                id={requisition.id}
                isFinalStep={amount === null || amount <= threshold || actorRole === "SUPER_ADMIN"}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
