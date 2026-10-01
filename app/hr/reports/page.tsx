import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { formatMonth, todayInDhaka } from "@/lib/dates";
import {
  attendanceReport,
  certificateReport,
  documentReport,
  headcount,
  leaveReport,
  terminalReport,
} from "@/lib/reports";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";

export const metadata = { title: "Reports · FCSL HR" };

/** §6.10 — the questions a Head of HR is actually asked. */
export default async function Page() {
  await requireCapability("reports.read");
  const today = todayInDhaka();
  const year = today.getUTCFullYear();
  const lastMonth = new Date(Date.UTC(year, today.getUTCMonth() - 1, 1));

  const [people, leave, documents, certificates, terminals, attendance] = await Promise.all([
    headcount(),
    leaveReport(year),
    documentReport(),
    certificateReport(),
    terminalReport(),
    attendanceReport(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Reports"
        subtitle="Everything below is counted from the same rows the screens use, so a report cannot disagree with the page it summarises."
        actions={
          <a
            href="/api/export?type=employees"
            className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            Export the employee list
          </a>
        }
      />

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Headcount</h2>
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Active" value={people.active} big />
          <Stat label="Employees" value={people.employees} />
          <Stat label="Associates" value={people.rms} />
          <Stat label="Managers" value={people.managers} />
          <Stat label="Joined this month" value={people.joinedThisMonth} />
          <Stat
            label="Net change"
            value={people.net}
            tone={people.net < 0 ? "danger" : people.net > 0 ? "success" : "neutral"}
          />
        </div>
        <p className="mb-4 text-xs text-ink-500">
          {/* §6.6: this is what marking somebody Left makes possible. */}
          {people.left} {people.left === 1 ? "person has" : "people have"} left and are kept on
          record — {people.leftThisMonth} this month. Their files are never deleted, which is why
          these figures stay correct.
        </p>

        <div className="grid gap-4 lg:grid-cols-3">
          <Breakdown title="By branch" rows={people.byBranch.map((b) => ({ name: b.name, value: b.active }))} />
          <Breakdown title="By department" rows={people.byDepartment.map((d) => ({ name: d.name, value: d.active }))} />
          <Breakdown title="By grade" rows={people.byGrade.map((g) => ({ name: g.name, value: g.active }))} />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Associate certificates and trading terminals
        </h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Expired" value={certificates.expired} tone={certificates.expired ? "danger" : "neutral"} />
          <Stat label="Next 3 months" value={certificates.three} tone={certificates.three ? "warn" : "neutral"} />
          <Stat label="Next 12 months" value={certificates.twelve} />
          <Stat
            label="Associates with none"
            value={certificates.withoutCertificate}
            tone={certificates.withoutCertificate ? "warn" : "neutral"}
          />
          <Stat
            label="Terminals at risk"
            value={terminals.atRisk}
            tone={terminals.atRisk ? "danger" : "neutral"}
          />
        </div>
        <p className="mt-2 text-xs text-ink-500">
          {terminals.total} terminals · {terminals.assigned} assigned · {terminals.free} free.{" "}
          <Link href="/hr/terminals" className="text-brand-500 hover:underline">
            &ldquo;At risk&rdquo;
          </Link>{" "}
          means held by somebody who has left or whose certificate is expired or missing.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Leave, {year}</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <TableShell>
            <Thead>
              <tr>
                <Th>Type</Th>
                <Th className="text-right">Days taken</Th>
                <Th className="text-right">People</Th>
              </tr>
            </Thead>
            <Tbody>
              {leave.byType.map((row) => (
                <tr key={row.name}>
                  <Td>{row.name}</Td>
                  <Td className="text-right tabular">{row.daysTaken}</Td>
                  <Td className="text-right tabular">{row.people}</Td>
                </tr>
              ))}
            </Tbody>
          </TableShell>

          <div className="space-y-4">
            <Card className="p-5">
              <h3 className="text-xs font-semibold tracking-widest text-ink-400">
                CLOSE TO RUNNING OUT
              </h3>
              {leave.nearlyExhausted.length === 0 ? (
                <p className="mt-2 text-sm text-ink-400">Nobody is near their limit.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {leave.nearlyExhausted.slice(0, 8).map((row, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="text-ink-900">{row.name}</span>
                      <span className="text-ink-500">
                        {row.left} of {row.type.toLowerCase()} left
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="text-xs font-semibold tracking-widest text-ink-400">
                HAVE TAKEN NO LEAVE AT ALL
              </h3>
              <p className="mt-1 text-xs text-ink-500">
                {/* §6.10 flags this deliberately: "which is itself worth
                    knowing in a brokerage." */}
                Worth knowing in a brokerage — somebody who never takes a day off is somebody whose
                work nobody else has ever had to pick up.
              </p>
              {leave.tookNoneTotal === 0 ? (
                <p className="mt-2 text-sm text-ink-400">Everybody has taken some.</p>
              ) : (
                <p className="mt-2 text-sm text-ink-700">
                  {/* The count is a real count; the names are the first few. */}
                  {leave.tookNoneTotal} {leave.tookNoneTotal === 1 ? "person" : "people"} —{" "}
                  {leave.tookNone.slice(0, 6).map((p) => p.name).join(", ")}
                  {leave.tookNoneTotal > 6 ? " and others" : ""}
                </p>
              )}
            </Card>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">
          Branch attendance — {formatMonth(attendance.month.year, attendance.month.month)}
        </h2>
        {attendance.branches.length === 0 ? (
          <EmptyState>No branch has published that month yet.</EmptyState>
        ) : (
          <TableShell>
            <Thead>
              <tr>
                <Th>Branch</Th>
                <Th className="text-right">Attendance</Th>
                <Th className="text-right">Absent</Th>
                <Th className="text-right">Late</Th>
              </tr>
            </Thead>
            <Tbody>
              {attendance.branches.map((branch) => (
                <tr key={branch.name}>
                  <Td>{branch.name}</Td>
                  <Td className="text-right tabular">{branch.rate}%</Td>
                  <Td className="text-right tabular">{branch.absent}</Td>
                  <Td className="text-right tabular">{branch.late}</Td>
                </tr>
              ))}
            </Tbody>
          </TableShell>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Files that are still incomplete</h2>
        <p className="mb-3 text-xs text-ink-500">
          And how long they have been that way. §1&rsquo;s second problem, as a list.
        </p>
        <TableShell>
          <Thead>
            <tr>
              <Th>Employee ID</Th>
              <Th>Name</Th>
              <Th className="text-right">Missing</Th>
              <Th className="text-right">Days</Th>
            </tr>
          </Thead>
          <Tbody>
            {documents.incompleteTotal === 0 && (
              <TableEmpty colSpan={4}>
                Every active employee file is complete. That is the point of the locked door.
              </TableEmpty>
            )}
            {documents.incomplete.slice(0, 25).map((row) => (
              <tr key={row.id}>
                <Td className="tabular text-ink-500">{row.employeeId ?? "—"}</Td>
                <Td>
                  <Link href={`/hr/employees/${row.id}`} className="text-brand-500 hover:underline">
                    {row.name}
                  </Link>
                </Td>
                <Td className="text-right">
                  <Badge tone={row.missing > 2 ? "danger" : "warn"}>{row.missing}</Badge>
                </Td>
                <Td className="text-right tabular">{row.waitingDays}</Td>
              </tr>
            ))}
          </Tbody>
        </TableShell>
        {documents.incompleteTotal > 25 && (
          // Said rather than silently truncated. A list that stops at
          // twenty-five without saying so reads as "twenty-five files are
          // incomplete", which is a different and much better number.
          <p className="mt-3 text-xs text-ink-500">
            Showing the 25 longest-waiting of {documents.incompleteTotal} incomplete files.{" "}
            <Link href="/hr/employees" className="text-brand-500 hover:underline">
              Find anybody
            </Link>{" "}
            filters the whole list.
          </p>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  big,
  tone = "neutral",
}: {
  label: string;
  value: number;
  big?: boolean;
  tone?: "neutral" | "warn" | "danger" | "success";
}) {
  const colour =
    tone === "danger"
      ? "text-red-600"
      : tone === "warn"
        ? "text-warn-500"
        : tone === "success"
          ? "text-success-500"
          : "text-ink-900";
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</p>
      <p className={`mt-1 font-bold tabular ${big ? "text-3xl" : "text-2xl"} ${colour}`}>{value}</p>
    </Card>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { name: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
        {title.toUpperCase()}
      </h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="flex justify-between text-sm">
              <span className="truncate text-ink-700">{row.name}</span>
              <span className="tabular text-ink-900">{row.value}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-300/20">
              <div className="h-full bg-brand-500" style={{ width: `${(row.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
