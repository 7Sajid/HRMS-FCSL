import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { employeeRecordScope, visibleEmployeeWhere } from "@/lib/permissions";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { ensureEntitlements, leaveTypesFor } from "@/lib/leave-service";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataList, DataRow } from "@/components/ui/DataList";
import { Badge, NoticeBox } from "@/components/ui/Feedback";

type Props = { params: Promise<{ id: string }> };

/**
 * One team member, as a manager sees them.
 *
 * The scope is asked IN THE QUERY: a member outside this manager's team simply
 * does not match, so the page 404s rather than fetching a record and then
 * deciding not to show it.
 *
 * And for somebody who has since moved on, §5.2's second half applies — the
 * old manager keeps the period they managed and loses everything after the
 * transfer date. That is what `employeeRecordScope` decides, and when it comes
 * back limited every field on this page is read from the assignment row for
 * that period rather than from the person's current record.
 */
export default async function Page({ params }: Props) {
  const context = await requireCapability("team.readRecords");
  const { id } = await params;
  const self = context.employeeId ?? "__none__";

  const member = await prisma.employee.findFirst({
    where: {
      AND: [{ id }, visibleEmployeeWhere(context.viewer, context.employeeId)],
    },
    include: {
      designation: true,
      grade: true,
      branch: true,
      department: true,
      manager: true,
      // Only the spells under THIS viewer. Somebody else's management history
      // is not this manager's to read either.
      assignments: {
        where: { managerId: self },
        orderBy: { effectiveFrom: "desc" },
        include: { designation: true, grade: true, branch: true, department: true },
      },
    },
  });
  if (!member) notFound();

  const scope = employeeRecordScope(context.viewer, context.employeeId, member, member.assignments);
  if (!scope) notFound();

  // The row for the spell that ended last — the record as this manager last
  // had any business seeing it.
  const period = scope.limited
    ? member.assignments.find((a) => a.effectiveTo?.getTime() === scope.until.getTime())
    : null;

  // A current figure, so it belongs to whoever manages them now.
  const balances: Awaited<ReturnType<typeof leaveTypesFor>> = [];
  if (!scope.limited) {
    // Granted before it is read, as the person's own leave page does — a
    // manager should not see "0 of 0" for somebody who simply has not opened
    // their own screen yet.
    const year = todayInDhaka().getUTCFullYear();
    await ensureEntitlements(member, year);
    balances.push(...(await leaveTypesFor(member, year)));
  }

  const shown = period ?? member;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        eyebrow={member.employeeId ?? undefined}
        title={member.fullName}
        subtitle={shown.designation?.name ?? undefined}
        actions={
          scope.limited ? (
            <Badge tone="neutral">Former team member</Badge>
          ) : member.status === "ACTIVE" ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge tone="neutral">Left</Badge>
          )
        }
      />

      {scope.limited && (
        <div className="mb-4">
          <NoticeBox tone="warn">
            <strong className="font-medium">
              {member.fullName.split(" ")[0]} reported to you until {formatDate(scope.until)}.
            </strong>{" "}
            This is their record as it stood then. Anything that has changed since — where they
            work, what they do, who they report to, their leave — belongs to whoever manages them
            now, and is not shown here.
          </NoticeBox>
        </div>
      )}

      <Card className="p-6">
        <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">
          {scope.limited ? "EMPLOYMENT AT THAT TIME" : "EMPLOYMENT"}
        </h2>
        <DataList>
          <DataRow label="Branch" value={shown.branch?.name} />
          <DataRow label="Department" value={shown.department?.name} />
          <DataRow label="Designation" value={shown.designation?.name} />
          <DataRow label="Grade" value={shown.grade?.name} />
          {scope.limited ? (
            <>
              <DataRow label="Reported to you" value={`From ${formatDate(period!.effectiveFrom)}`} />
              <DataRow label="Until" value={formatDate(scope.until)} />
            </>
          ) : (
            <>
              <DataRow label="Reports to" value={member.manager?.fullName} />
              <DataRow
                label="Joined"
                value={member.joiningDate ? formatDate(member.joiningDate) : ""}
              />
            </>
          )}
        </DataList>
      </Card>

      {!scope.limited && (
        <Card className="mt-4 p-6">
          <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">
            LEAVE REMAINING
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.map((type) => (
              <div key={type.id}>
                <p className="text-xs uppercase tracking-wide text-ink-400">{type.name}</p>
                <p className="text-xl font-bold tabular text-ink-900">
                  {type.uncounted ? "\u2014" : type.balance.applicable}
                </p>
                <p className="text-xs text-ink-500">
                  {type.uncounted ? "not counted" : `of ${type.balance.entitled}`}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="mt-4 text-xs text-ink-400">
        Bank details, national ID and documents are not shown here. They are HR&rsquo;s to hold.
      </p>
    </main>
  );
}
