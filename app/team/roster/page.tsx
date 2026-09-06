import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { visibleEmployeeWhere } from "@/lib/permissions";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";

export const metadata = { title: "My team · FCSL HR" };

/**
 * §5.2 — "a manager sees their own team and nobody else's", and specifically
 * NOT their bank details or NID. A manager needs to plan work, not hold
 * somebody's identity documents.
 *
 * The scope comes from visibleEmployeeWhere, which reaches through
 * EmployeeAssignment as well as the current manager pointer — so a manager
 * keeps the records of the period somebody reported to them and loses
 * everything after the transfer date.
 */
export default async function Page() {
  const context = await requireCapability("team.readRecords");
  const today = todayInDhaka();

  const team = await prisma.employee.findMany({
    where: {
      AND: [
        visibleEmployeeWhere(context.viewer, context.employeeId),
        // Their own row is not part of "my team".
        { id: { not: context.employeeId ?? "__none__" } },
      ],
    },
    include: { designation: true, branch: true, department: true },
    orderBy: [{ status: "asc" }, { fullName: "asc" }],
    take: 200,
  });

  // Who is away today — §6, "that last view alone prevents most of the
  // accidental double-booking that causes leave to be refused."
  const awayToday = await prisma.leaveDay.findMany({
    where: {
      employeeId: { in: team.map((t) => t.id) },
      date: today,
      lengthDays: { gt: 0 },
      leaveRequest: { status: "GRANTED" },
    },
    include: { leaveType: true },
  });
  const awayById = new Map(awayToday.map((d) => [d.employeeId, d.leaveType.name]));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="My team"
        subtitle="Everybody who reports to you, and who is away today."
      />

      {awayById.size > 0 && (
        <Card className="mb-6 p-5">
          <h2 className="text-xs font-semibold tracking-widest text-ink-400">AWAY TODAY</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {team
              .filter((member) => awayById.has(member.id))
              .map((member) => (
                <li key={member.id} className="flex items-center gap-2">
                  <span className="text-ink-900">{member.fullName}</span>
                  <Badge tone="brand">{awayById.get(member.id)}</Badge>
                </li>
              ))}
          </ul>
        </Card>
      )}

      {team.length === 0 ? (
        <EmptyState>Nobody reports to you yet.</EmptyState>
      ) : (
        <TableShell>
          <Thead>
            <tr>
              <Th>Employee ID</Th>
              <Th>Name</Th>
              <Th>Designation</Th>
              <Th>Branch</Th>
              <Th>Joined</Th>
              <Th>Status</Th>
            </tr>
          </Thead>
          <Tbody>
            {team.length === 0 && <TableEmpty colSpan={6}>Nobody reports to you yet.</TableEmpty>}
            {team.map((member) => (
              <tr key={member.id}>
                <Td className="whitespace-nowrap tabular text-ink-500">
                  {member.employeeId ?? "—"}
                </Td>
                <Td>
                  <Link href={`/team/roster/${member.id}`} className="text-brand-500 hover:underline">
                    {member.fullName}
                  </Link>
                </Td>
                <Td>{member.designation?.name ?? "—"}</Td>
                <Td>{member.branch?.name ?? "—"}</Td>
                <Td className="whitespace-nowrap">{formatDate(member.joiningDate)}</Td>
                <Td>
                  {member.status === "ACTIVE" ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="neutral">Left</Badge>
                  )}
                </Td>
              </tr>
            ))}
          </Tbody>
        </TableShell>
      )}

      <p className="mt-4 text-xs text-ink-400">
        {/* Said plainly, because employees ask and managers should be able to
            answer without checking. */}
        You can see who is on your team and when they are away. You cannot see anybody&rsquo;s bank
        details, national ID or documents — those are HR&rsquo;s.
      </p>
    </main>
  );
}
