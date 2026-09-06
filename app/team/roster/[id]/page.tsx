import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { visibleEmployeeWhere } from "@/lib/permissions";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { leaveTypesFor } from "@/lib/leave-service";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataList, DataRow } from "@/components/ui/DataList";
import { Badge } from "@/components/ui/Feedback";

type Props = { params: Promise<{ id: string }> };

/**
 * One team member, as a manager sees them.
 *
 * The scope is asked IN THE QUERY: a member outside this manager's team simply
 * does not match, so the page 404s rather than fetching a record and then
 * deciding not to show it.
 */
export default async function Page({ params }: Props) {
  const context = await requireCapability("team.readRecords");
  const { id } = await params;

  const member = await prisma.employee.findFirst({
    where: {
      AND: [{ id }, visibleEmployeeWhere(context.viewer, context.employeeId)],
    },
    include: { designation: true, grade: true, branch: true, department: true, manager: true },
  });
  if (!member) notFound();

  const balances = await leaveTypesFor(member, todayInDhaka().getUTCFullYear());

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        eyebrow={member.employeeId ?? undefined}
        title={member.fullName}
        subtitle={member.designation?.name ?? undefined}
        actions={
          member.status === "ACTIVE" ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Left</Badge>
        }
      />

      <Card className="p-6">
        <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">EMPLOYMENT</h2>
        <DataList>
          <DataRow label="Branch" value={member.branch?.name} />
          <DataRow label="Department" value={member.department?.name} />
          <DataRow label="Designation" value={member.designation?.name} />
          <DataRow label="Grade" value={member.grade?.name} />
          <DataRow label="Reports to" value={member.manager?.fullName} />
          <DataRow label="Joined" value={member.joiningDate ? formatDate(member.joiningDate) : ""} />
        </DataList>
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">LEAVE REMAINING</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {balances.map((type) => (
            <div key={type.id}>
              <p className="text-xs uppercase tracking-wide text-ink-400">{type.name}</p>
              <p className="text-xl font-bold tabular text-ink-900">{type.balance.applicable}</p>
              <p className="text-xs text-ink-500">of {type.balance.entitled}</p>
            </div>
          ))}
        </div>
      </Card>

      <p className="mt-4 text-xs text-ink-400">
        Bank details, national ID and documents are not shown here. They are HR&rsquo;s to hold.
      </p>
    </main>
  );
}
