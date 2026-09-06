import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";

export const metadata = { title: "Leavers · FCSL HR" };

export default async function Page() {
  await requireCapability("exits.record");

  const [open, done, active] = await Promise.all([
    prisma.exit.findMany({
      where: { completedAt: null },
      include: {
        employee: { include: { branch: true, terminalAssignments: { where: { releasedOn: null } } } },
        clearanceItems: true,
      },
      orderBy: { lastWorkingDay: "asc" },
    }),
    prisma.exit.findMany({
      where: { completedAt: { not: null } },
      include: { employee: true },
      orderBy: { lastWorkingDay: "desc" },
      take: 25,
    }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED", exit: null },
      select: { id: true, fullName: true, employeeId: true },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Leavers"
        subtitle="Recording a departure, clearing every department, and marking the ID Left."
      />

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">In progress</h2>
        {open.length === 0 ? (
          <EmptyState>Nobody is currently leaving.</EmptyState>
        ) : (
          <div className="space-y-3">
            {open.map((exit) => {
              const outstanding = exit.clearanceItems.filter((i) => !i.clearedAt).length;
              const terminals = exit.employee.terminalAssignments.length;
              return (
                <Card key={exit.id} className="flex flex-wrap items-center gap-4 p-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink-900">{exit.employee.fullName}</p>
                      <span className="text-xs text-ink-400">{exit.employee.employeeId}</span>
                      {terminals > 0 && <Badge tone="danger">Terminal still assigned</Badge>}
                      {outstanding > 0 && <Badge tone="warn">{outstanding} to clear</Badge>}
                      {outstanding === 0 && terminals === 0 && (
                        <Badge tone="success">Ready to finish</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      Last working day {formatDate(exit.lastWorkingDay)} ·{" "}
                      {exit.reason.replace(/_/g, " ").toLowerCase()}
                    </p>
                  </div>
                  <Link
                    href={`/hr/exits/${exit.employeeId}`}
                    className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    Open
                  </Link>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Start an exit</h2>
        <Card className="p-5">
          <p className="mb-3 text-xs text-ink-500">
            Pick somebody to record a departure for. Open their file and use the exit section.
          </p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {active.slice(0, 40).map((person) => (
              <li key={person.id}>
                <Link href={`/hr/exits/${person.id}`} className="text-brand-500 hover:underline">
                  {person.fullName}
                </Link>
                <span className="ml-2 text-xs text-ink-400">{person.employeeId}</span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Finished</h2>
          <TableShell>
            <Thead>
              <tr>
                <Th>Employee ID</Th>
                <Th>Name</Th>
                <Th>Reason</Th>
                <Th>Last working day</Th>
                <Th>Files removed after</Th>
              </tr>
            </Thead>
            <Tbody>
              {done.length === 0 && <TableEmpty colSpan={5}>None yet.</TableEmpty>}
              {done.map((exit) => (
                <tr key={exit.id}>
                  <Td className="tabular text-ink-500">{exit.employee.employeeId}</Td>
                  <Td>{exit.employee.fullName}</Td>
                  <Td>{exit.reason.replace(/_/g, " ").toLowerCase()}</Td>
                  <Td>{formatDate(exit.lastWorkingDay)}</Td>
                  <Td>
                    {exit.documentsPurgedAt ? (
                      <Badge tone="neutral">Removed</Badge>
                    ) : (
                      formatDate(exit.documentsPurgeAfter)
                    )}
                  </Td>
                </tr>
              ))}
            </Tbody>
          </TableShell>
        </section>
      )}
    </main>
  );
}
