import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/auth";
import { formatDate, formatMonth, toISODate, todayInDhaka } from "@/lib/dates";
import { chainStart, waitingWith } from "@/lib/approval-chain";
import { calendarFor, ensureEntitlements, leaveTypesFor } from "@/lib/leave-service";
import { documentLabel } from "@/lib/documents";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";
import { ApplyForLeave } from "@/components/leave/ApplyForLeave";
import { WithdrawButton } from "@/components/leave/WithdrawButton";

export const metadata = { title: "Leave & attendance · FCSL HR" };

/**
 * Page 4 (§5.1) — three things on one screen: apply for leave, see every
 * application with its current position in the approval chain, and see the
 * month's attendance once HR has published it.
 */
export default async function Page() {
  const { employee, user } = await requireEmployee();
  const today = todayInDhaka();
  const year = today.getUTCFullYear();

  await ensureEntitlements(employee, year);

  const [types, calendar, requests, sheet, attachments] = await Promise.all([
    leaveTypesFor(employee, year),
    calendarFor(year),
    prisma.leaveRequest.findMany({
      where: { employeeId: employee.id },
      include: {
        leaveType: true,
        days: { orderBy: { date: "asc" } },
        approvals: { orderBy: { step: "asc" } },
      },
      orderBy: { appliedAt: "desc" },
      take: 50,
    }),
    employee.branchId
      ? prisma.attendanceSheet.findFirst({
          where: {
            branchId: employee.branchId,
            year,
            month: today.getUTCMonth() + 1,
            status: "PUBLISHED",
          },
          include: { entries: { where: { employeeId: employee.id }, orderBy: { date: "asc" } } },
        })
      : null,
    // Their own files, for the "which document is the certificate?" list. HR
    // has to have accepted it — an application evidenced by a rejected scan is
    // an application that will bounce back later for the same reason.
    prisma.employeeDocument.findMany({
      where: { employeeId: employee.id, status: "ACCEPTED", purgedAt: null, supersededAt: null },
      select: { id: true, kind: true, label: true, uploadedAt: true },
      orderBy: { uploadedAt: "desc" },
      take: 50,
    }),
  ]);

  const goesTo = waitingWith(chainStart(user.role).approver, user.role)
    .replace("Waiting with ", "")
    .replace("your manager", "your manager");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Leave & attendance"
        subtitle={`Your ${year} balances, everything you have applied for, and this month's attendance.`}
      />

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {types.map((type) => (
          <Card key={type.id} className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{type.name}</p>
            {type.uncounted ? (
              // No entitlement by definition, so there is no number to show.
              // It used to read "-1" the moment somebody applied for a day.
              <>
                <p className="mt-1 text-2xl font-bold text-ink-400">&mdash;</p>
                <p className="text-xs text-ink-500">Not counted against a balance</p>
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold tabular text-ink-900">
                  {type.balance.applicable}
                </p>
                <p className="text-xs text-ink-500">
                  of {type.balance.entitled} left
                  {type.balance.pending > 0 ? ` · ${type.balance.pending} waiting` : ""}
                </p>
              </>
            )}
          </Card>
        ))}
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Apply for leave</h2>
        <Card className="p-6">
          {types.length ? (
            <ApplyForLeave
              types={types.map((t) => ({
                id: t.id,
                name: t.name,
                applicable: t.balance.applicable,
                available: t.balance.available,
                pending: t.balance.pending,
                uncounted: t.uncounted,
                attachmentRequiredAfterDays: t.attachmentRequiredAfterDays,
              }))}
              goesTo={goesTo === "Finished" ? "nobody — it is recorded directly" : goesTo}
              holidays={[...calendar.holidays]}
              halfDayHolidays={[...calendar.halfDayHolidays]}
              weeklyOffDays={[...calendar.weeklyOffDays]}
              attachments={attachments.map((d) => ({
                id: d.id,
                label: `${documentLabel(d.kind)}${d.label ? ` — ${d.label}` : ""} (${formatDate(d.uploadedAt)})`,
              }))}
              today={toISODate(today)}
            />
          ) : (
            <EmptyState>HR has not set up any leave types yet.</EmptyState>
          )}
        </Card>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">My applications</h2>
        <TableShell>
          <Thead>
            <tr>
              <Th>Type</Th>
              <Th>Dates</Th>
              <Th className="text-right">Days</Th>
              <Th>Where it is</Th>
              <Th />
            </tr>
          </Thead>
          <Tbody>
            {requests.length === 0 && (
              <TableEmpty colSpan={5}>You have not applied for any leave yet.</TableEmpty>
            )}
            {requests.map((request) => {
              const cost = request.days.reduce((total, d) => total + Number(d.lengthDays), 0);
              const first = request.days[0]?.date;
              const last = request.days.at(-1)?.date;
              const denial = request.approvals.find((a) => a.decision === "DENIED");
              const started = first ? first <= today : false;

              return (
                <tr key={request.id}>
                  <Td>{request.leaveType.name}</Td>
                  <Td className="whitespace-nowrap">
                    {formatDate(first)}
                    {last && last !== first ? ` – ${formatDate(last)}` : ""}
                  </Td>
                  <Td className="text-right tabular">{cost}</Td>
                  <Td>
                    {request.status === "PENDING" && (
                      <span className="text-ink-700">
                        {waitingWith(request.currentApproverRole, user.role)}
                        {request.approvals.length > 0 && (
                          <span className="block text-xs text-ink-400">
                            Approved by {request.approvals.map((a) => a.approverName).join(", ")}
                          </span>
                        )}
                      </span>
                    )}
                    {request.status === "GRANTED" && <Badge tone="success">Granted</Badge>}
                    {request.status === "DENIED" && (
                      <span>
                        <Badge tone="danger">Denied</Badge>
                        {denial && (
                          <span className="mt-1 block text-xs text-ink-500">
                            {denial.approverName}: {denial.reason}
                          </span>
                        )}
                      </span>
                    )}
                    {request.status === "WITHDRAWN" && <Badge tone="neutral">Withdrawn</Badge>}
                    {request.status === "CANCELLED" && <Badge tone="neutral">Cancelled</Badge>}
                  </Td>
                  <Td className="text-right">
                    {request.status === "PENDING" && <WithdrawButton id={request.id} label="Withdraw" />}
                    {request.status === "GRANTED" && !started && (
                      <WithdrawButton id={request.id} label="Cancel" />
                    )}
                  </Td>
                </tr>
              );
            })}
          </Tbody>
        </TableShell>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          My attendance — {formatMonth(year, today.getUTCMonth() + 1)}
        </h2>
        {sheet ? (
          <Card className="p-6">
            <div className="grid grid-cols-7 gap-1 text-center text-xs">
              {sheet.entries.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-lg px-1 py-2 ${MARK_TONE[entry.mark] ?? "bg-surface text-ink-500"}`}
                >
                  <div className="font-medium">{entry.date.getUTCDate()}</div>
                  <div className="mt-0.5 text-[10px]">{MARK_LABEL[entry.mark] ?? entry.mark}</div>
                </div>
              ))}
            </div>
          </Card>
        ) : (
          <EmptyState>
            {/* §6.3, in the words the specification asks for. */}
            Not yet published.
          </EmptyState>
        )}
      </section>
    </main>
  );
}

const MARK_LABEL: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  ON_LEAVE: "Leave",
  PUBLIC_HOLIDAY: "Holiday",
  WEEKLY_OFF: "Off",
  OFFICIAL_DUTY: "Duty",
};

const MARK_TONE: Record<string, string> = {
  PRESENT: "bg-success-50 text-success-500",
  ABSENT: "bg-red-50 text-red-600",
  LATE: "bg-warn-50 text-warn-500",
  ON_LEAVE: "bg-brand-50 text-brand-500",
  PUBLIC_HOLIDAY: "bg-surface text-ink-400",
  WEEKLY_OFF: "bg-surface text-ink-400",
  OFFICIAL_DUTY: "bg-brand-50 text-brand-500",
};
