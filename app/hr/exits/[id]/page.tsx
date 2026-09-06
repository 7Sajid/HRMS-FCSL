import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/dates";
import { AREA_LABEL, exitBlockers } from "@/lib/exit";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import {
  ClearanceItem,
  CompleteExitButton,
  RecordExitForm,
} from "@/components/hr/ExitPanel";

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  await requireCapability("exits.record");
  const { id } = await params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      branch: true,
      designation: true,
      exit: { include: { clearanceItems: { orderBy: { area: "asc" } } } },
      terminalAssignments: { where: { releasedOn: null }, include: { terminal: true } },
      certificates: { where: { status: "ACTIVE" } },
    },
  });
  if (!employee) notFound();

  const exit = employee.exit;
  const blockers = exit
    ? exitBlockers({
        openTerminals: employee.terminalAssignments.length,
        unclearedItems: exit.clearanceItems.filter((i) => !i.clearedAt).length,
      })
    : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        eyebrow={employee.employeeId ?? undefined}
        title={employee.fullName}
        subtitle={[employee.designation?.name, employee.branch?.name].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            {employee.status === "LEFT" && <Badge tone="neutral">Left</Badge>}
            <Link
              href="/hr/exits"
              className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
            >
              Back
            </Link>
          </div>
        }
      />

      {!exit ? (
        <Card className="p-6">
          <h2 className="mb-4 text-sm font-semibold text-ink-900">Record their departure</h2>
          <RecordExitForm employeeId={employee.id} />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">THE DEPARTURE</h2>
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <Row label="Reason" value={exit.reason.replace(/_/g, " ").toLowerCase()} />
              <Row label="Last working day" value={formatDate(exit.lastWorkingDay)} />
              <Row label="Recorded by" value={`${exit.recordedByName}, ${formatDateTime(exit.recordedAt)}`} />
              <Row
                label="Files removed after"
                value={`${formatDate(exit.documentsPurgeAfter)} — the record itself is kept for ever`}
              />
              {exit.reasonNote && <Row label="Note" value={exit.reasonNote} />}
            </dl>
          </Card>

          {employee.terminalAssignments.length > 0 && (
            <Card className="border-red-300 bg-red-50/40 p-6">
              <h2 className="text-sm font-medium text-red-700">
                A trading terminal is still assigned to them
              </h2>
              <ul className="mt-2 space-y-1 text-sm text-ink-700">
                {employee.terminalAssignments.map((assignment) => (
                  <li key={assignment.id}>
                    {assignment.terminal.terminalId} · {assignment.terminal.exchange} · assigned{" "}
                    {formatDate(assignment.assignedOn)}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-600">
                {/* §6.9: the question a BSEC inspection asks. */}
                The exit cannot be finished until this is surrendered. Somebody who has left holding
                a live terminal is exactly what an inspection asks about. The HR Head releases it on
                the trading terminal register.
              </p>
            </Card>
          )}

          {employee.certificates.length > 0 && (
            <NoticeBox tone="brand">
              Their RM certificate will be surrendered when you finish the exit, and they drop out of
              the expiry register.
            </NoticeBox>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink-900">
              Clearance — {exit.clearanceItems.filter((i) => i.clearedAt).length} of{" "}
              {exit.clearanceItems.length} done
            </h2>
            <Card className="divide-y divide-ink-300/20">
              {exit.clearanceItems.map((item) => (
                <ClearanceItem
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  area={AREA_LABEL[item.area]}
                  clearedBy={item.clearedByName}
                  clearedAt={item.clearedAt ? formatDate(item.clearedAt) : null}
                  note={item.note}
                  locked={Boolean(exit.completedAt)}
                />
              ))}
            </Card>
          </section>

          {exit.completedAt ? (
            <NoticeBox tone="success">
              <p className="font-medium">
                Finished on {formatDateTime(exit.completedAt)} by {exit.completedByName}.
              </p>
              <p className="mt-1">
                {employee.employeeId} is marked Left. The ID is never reused and the record is kept
                whole, so the headcount and joiner-leaver reports stay correct.
              </p>
            </NoticeBox>
          ) : (
            <CompleteExitButton employeeId={employee.id} blockers={blockers} />
          )}
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink-900">{value}</dd>
    </div>
  );
}
