import { prisma } from "@/lib/db";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { byLongestWaiting, escalateAfterWorkingDays, isOverdue } from "@/lib/escalation";
import { chainAdvance } from "@/lib/approval-chain";
import { leaveTypesForMany } from "@/lib/leave-service";
import { Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { DecideButtons } from "./DecideButtons";
import type { Role } from "@prisma/client";

/**
 * The list of applications waiting with one person, shared by the manager's
 * page, the HR Head's inbox and the Super Admin's.
 *
 * §7.3: anything waiting more than three working days moves to the top and
 * turns amber. The single commonest failure of an approval system is requests
 * sitting unseen in a screen nobody opens.
 */
export async function LeaveInbox({
  actorRole,
  actorEmployeeId,
}: {
  actorRole: Role;
  actorEmployeeId: string | null;
}) {
  const requests = await prisma.leaveRequest.findMany({
    where: {
      status: "PENDING",
      currentApproverRole: actorRole,
      // A manager sees their own team and nobody else's.
      ...(actorRole === "MANAGER"
        ? { employee: { managerId: actorEmployeeId ?? "__none__" } }
        : {}),
    },
    include: {
      leaveType: true,
      days: { orderBy: { date: "asc" } },
      approvals: { orderBy: { step: "asc" } },
      employee: {
        include: {
          user: { select: { role: true } },
          designation: true,
          branch: true,
        },
      },
    },
    orderBy: { appliedAt: "asc" },
  });

  if (!requests.length) {
    return <EmptyState>Nothing is waiting with you.</EmptyState>;
  }

  const today = todayInDhaka();

  // Balances are what a decision actually turns on — "how much leave that
  // person has left" is in §5.2's list of what each row must show.
  //
  // Asked once for everybody on the screen. It used to be asked once per row,
  // and each ask was four queries, so an inbox of fifty applications cost two
  // hundred round trips on the page an HR Head opens every morning.
  const balances = new Map<string, number | null>();
  const byEmployee = await leaveTypesForMany(
    requests.map((request) => request.employee),
    today,
  );
  for (const [employeeId, types] of byEmployee) {
    for (const type of types) {
      // null for a type with no balance — leave without pay. "They have -1
      // days left" is not something an approver should be shown.
      balances.set(`${employeeId}:${type.id}`, type.uncounted ? null : type.balance.applicable);
    }
  }

  const threshold = await escalateAfterWorkingDays();
  const rows = byLongestWaiting(requests, (request) => request.appliedAt, today).map(
    ({ item, waited }) => ({ request: item, waited }),
  );

  return (
    <div className="space-y-3">
      {rows.map(({ request, waited }) => {
        const cost = request.days.reduce((total, d) => total + Number(d.lengthDays), 0);
        const first = request.days[0]?.date ?? null;
        const last = request.days.at(-1)?.date ?? null;
        const overdue = isOverdue(waited, threshold);
        const next = chainAdvance(request.employee.user.role, request.currentStep);
        const left = balances.get(`${request.employeeId}:${request.leaveTypeId}`);

        return (
          <Card
            key={request.id}
            className={`p-5 ${overdue ? "border-warn-500/50 bg-warn-50/30" : ""}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink-900">{request.employee.fullName}</p>
                  {request.employee.employeeId && (
                    <span className="text-xs text-ink-400">{request.employee.employeeId}</span>
                  )}
                  {overdue && <Badge tone="warn">Waiting {waited} working days</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  {request.employee.designation?.name ?? "—"}
                  {request.employee.branch ? ` · ${request.employee.branch.name}` : ""}
                </p>

                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <Row label="Type" value={request.leaveType.name} />
                  <Row
                    label="Dates"
                    value={`${formatDate(first)}${last && last !== first ? ` – ${formatDate(last)}` : ""}`}
                  />
                  <Row label="Working days" value={String(cost)} />
                  <Row
                    label="They have left"
                    value={
                      left === undefined
                        ? "\u2014"
                        : left === null
                          ? "not counted"
                          : `${left} day${left === 1 ? "" : "s"}`
                    }
                  />
                </dl>

                <p className="mt-3 text-sm text-ink-700">
                  <span className="text-xs uppercase tracking-wide text-ink-400">Reason </span>
                  {request.reason}
                </p>
                {request.lateReason && (
                  <p className="mt-1 text-sm text-warn-500">
                    <span className="text-xs uppercase tracking-wide">Applied late </span>
                    {request.lateReason}
                  </p>
                )}

                {request.approvals.length > 0 && (
                  <p className="mt-3 text-xs text-ink-500">
                    Already approved by{" "}
                    {request.approvals.map((a) => `${a.approverName} (${a.approverRole})`).join(", ")}
                  </p>
                )}
              </div>

              <div className="shrink-0">
                <DecideButtons id={request.id} isFinalStep={next.approver === null} />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-xs uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-ink-900">{value}</dd>
    </div>
  );
}
