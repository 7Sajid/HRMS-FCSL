import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate, todayInDhaka } from "@/lib/dates";
import { certificateStatus } from "@/lib/certificate";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { AddTerminalForm, AssignTerminal, ReleaseTerminal } from "@/components/registers/TerminalForms";

export const metadata = { title: "Trading terminals · FCSL HR" };

/**
 * §6.9 — the TWS register.
 *
 * "Keeping the terminal register next to the certificate register and the
 * staff list means the system can answer the awkward question by itself: is
 * anybody holding an active terminal whose certificate has expired, or who has
 * already left the company? That question is very hard to answer when the two
 * lists live in different departments — and it is exactly the question a BSEC
 * inspection asks."
 *
 * So that question is answered at the top of this page, every time it loads.
 */
export default async function Page() {
  await requireCapability("terminals.manage");
  const today = todayInDhaka();

  const [terminals, branches, people] = await Promise.all([
    prisma.tradingTerminal.findMany({
      include: {
        branch: true,
        assignments: {
          where: { releasedOn: null },
          include: {
            employee: { include: { certificates: { where: { status: "ACTIVE" } }, ...{} } },
          },
        },
      },
      orderBy: { terminalId: "asc" },
    }),
    prisma.branch.findMany({ where: { closedOn: null }, orderBy: { name: "asc" } }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED", staffType: "RM" },
      select: { id: true, fullName: true, employeeId: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  // The question §6.9 exists to answer.
  const problems = terminals.flatMap((terminal) =>
    terminal.assignments.flatMap((assignment) => {
      const employee = assignment.employee;
      const certificate = certificateStatus(employee.certificates[0] ?? null, today);
      const reasons: string[] = [];
      if (employee.status === "LEFT") reasons.push("has left the company");
      if (certificate.state === "EXPIRED") reasons.push("has an expired RM certificate");
      if (certificate.state === "NONE") reasons.push("has no RM certificate on file");
      return reasons.length
        ? [{ terminal: terminal.terminalId, name: employee.fullName, id: employee.id, reasons }]
        : [];
    }),
  );

  const held = terminals.filter((t) => t.assignments.length > 0).length;
  const free = terminals.filter((t) => t.assignments.length === 0 && t.status === "ACTIVE").length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Trading terminals"
        subtitle="Every TWS ID the company holds, and who is using it."
      />

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="On the register" value={terminals.length} />
        <Stat label="Assigned" value={held} />
        <Stat label="Free" value={free} />
      </section>

      {problems.length > 0 ? (
        <Card className="mb-6 border-red-300 bg-red-50/40 p-5">
          <h2 className="text-sm font-medium text-red-700">
            {problems.length} terminal{problems.length === 1 ? " is" : "s are"} held by somebody who
            should not have one
          </h2>
          <ul className="mt-3 space-y-1 text-sm text-ink-700">
            {problems.map((problem) => (
              <li key={problem.terminal}>
                <span className="font-medium">{problem.terminal}</span> ·{" "}
                <Link href={`/hr/employees/${problem.id}`} className="text-brand-500 hover:underline">
                  {problem.name}
                </Link>{" "}
                {problem.reasons.join(" and ")}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-600">
            This is the question a BSEC inspection asks, and the reason this register sits beside the
            certificate register rather than with IT.
          </p>
        </Card>
      ) : (
        terminals.length > 0 && (
          <Card className="mb-6 border-success-500/40 bg-success-50/30 p-5">
            <p className="text-sm text-ink-700">
              Every assigned terminal is held by somebody still employed with a valid certificate.
            </p>
          </Card>
        )
      )}

      <section className="mb-10">
        {terminals.length === 0 ? (
          <EmptyState>No terminals on the register yet.</EmptyState>
        ) : (
          <Card className="divide-y divide-ink-300/20">
            {terminals.map((terminal) => {
              const assignment = terminal.assignments[0] ?? null;
              return (
                <div key={terminal.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-ink-900">{terminal.terminalId}</p>
                      <Badge tone="neutral">{terminal.exchange}</Badge>
                      {terminal.status === "SURRENDERED" && <Badge tone="neutral">Surrendered</Badge>}
                      {terminal.status === "SUSPENDED" && <Badge tone="warn">Suspended</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {terminal.branch?.name ?? "no branch"} ·{" "}
                      {assignment
                        ? `${assignment.employee.fullName} since ${formatDate(assignment.assignedOn)}`
                        : "not assigned"}
                    </p>
                  </div>
                  {assignment ? (
                    <ReleaseTerminal assignmentId={assignment.id} />
                  ) : (
                    terminal.status === "ACTIVE" && (
                      <AssignTerminal
                        terminalId={terminal.id}
                        people={people.map((p) => ({
                          id: p.id,
                          name: `${p.fullName}${p.employeeId ? ` · ${p.employeeId}` : ""}`,
                        }))}
                      />
                    )
                  )}
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Add a terminal</h2>
        <Card className="p-6">
          <AddTerminalForm branches={branches.map((b) => ({ id: b.id, name: b.name }))} />
        </Card>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular text-ink-900">{value}</p>
    </Card>
  );
}
