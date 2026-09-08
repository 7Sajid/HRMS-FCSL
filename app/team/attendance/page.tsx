import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { calendarFor } from "@/lib/leave-service";
import { prefillMonth, unfilled } from "@/lib/attendance";
import { formatMonth, toISODate, todayInDhaka } from "@/lib/dates";
import { EmptyState, PageHeader } from "@/components/ui/Card";
import { AttendanceGrid, type GridCell } from "@/components/attendance/Grid";
import type { AttendanceMark } from "@prisma/client";

export const metadata = { title: "Attendance sheet · FCSL HR" };

type Props = { searchParams: Promise<{ m?: string }> };

/**
 * §6.3 — the branch sheet, once a month, through the branch manager.
 *
 * Submitting locks it. An attendance record that can be changed quietly
 * afterwards is worth nothing in a dispute.
 */
export default async function Page({ searchParams }: Props) {
  const context = await requireCapability("attendance.submit");
  const today = todayInDhaka();

  const [yearStr, monthStr] = ((await searchParams).m ?? "").split("-");
  const year = Number(yearStr) || today.getUTCFullYear();
  const month = Number(monthStr) || today.getUTCMonth() + 1;

  // A manager fills in the branch they manage — not every branch, and not
  // simply the one they happen to sit in.
  const branch = await prisma.branch.findFirst({
    where: { branchManagerId: context.employeeId ?? "__none__", closedOn: null },
  });

  if (!branch) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <PageHeader title="Attendance sheet" subtitle="Once a month, for your branch." />
        <EmptyState>
          You are not recorded as the manager of any branch, so there is no sheet to fill in. HR sets
          this on the branch record.
        </EmptyState>
      </main>
    );
  }

  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));

  const [people, calendar, sheet, leaveDays] = await Promise.all([
    prisma.employee.findMany({
      where: {
        branchId: branch.id,
        onboardingStatus: "APPROVED",
        // Somebody who left before this month started is not on this sheet,
        // and neither is somebody who had not joined yet. The roster filtered
        // on who had LEFT and never on who had not yet arrived, so a September
        // joiner appeared on January's grid and could be marked Absent for a
        // month they did not work here.
        AND: [
          { OR: [{ status: "ACTIVE" }, { lastWorkingDay: { gte: first } }] },
          { OR: [{ joiningDate: null }, { joiningDate: { lte: last } }] },
        ],
      },
      orderBy: { fullName: "asc" },
    }),
    calendarFor(year),
    prisma.attendanceSheet.findUnique({
      where: { branchId_year_month: { branchId: branch.id, year, month } },
      include: { entries: true },
    }),
    prisma.leaveDay.findMany({
      where: {
        date: { gte: first, lte: last },
        lengthDays: { gt: 0 },
        leaveRequest: { status: "GRANTED" },
        employee: { branchId: branch.id },
      },
      select: { employeeId: true, date: true },
    }),
  ]);

  const onLeaveBy = new Map<string, Set<string>>();
  for (const day of leaveDays) {
    const set = onLeaveBy.get(day.employeeId) ?? new Set<string>();
    set.add(toISODate(day.date));
    onLeaveBy.set(day.employeeId, set);
  }

  const entered = new Map<string, AttendanceMark>();
  for (const entry of sheet?.entries ?? []) {
    entered.set(`${entry.employeeId}:${toISODate(entry.date)}`, entry.mark);
  }

  const cells: Record<string, GridCell[]> = {};
  let remaining = 0;
  for (const person of people) {
    const prefilled = prefillMonth(year, month, {
      holidays: calendar.holidays,
      weeklyOffDays: calendar.weeklyOffDays,
      onLeave: onLeaveBy.get(person.id) ?? new Set(),
      from: person.joiningDate,
      to: person.status === "LEFT" ? person.lastWorkingDay : null,
    });

    cells[person.id] = prefilled.map((cell) => {
      const iso = toISODate(cell.date);
      return {
        iso,
        day: cell.date.getUTCDate(),
        mark: cell.locked ? cell.mark : (entered.get(`${person.id}:${iso}`) ?? null),
        locked: cell.locked,
        employed: cell.employed,
      };
    });

    remaining += unfilled(
      prefilled,
      new Map(
        [...entered.entries()]
          .filter(([key]) => key.startsWith(`${person.id}:`))
          .map(([key, mark]) => [key.split(":")[1]!, mark]),
      ),
    );
  }

  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow={branch.name.toUpperCase()}
        title={`Attendance — ${formatMonth(year, month)}`}
        subtitle="Approved leave, Fridays, Saturdays and public holidays are filled in already and cannot be changed."
        actions={
          <div className="flex gap-1">
            <a
              href={`/team/attendance?m=${previous}`}
              className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm hover:bg-surface"
            >
              ←
            </a>
            <a
              href={`/team/attendance?m=${next}`}
              className="rounded-lg border border-ink-300/60 bg-white px-3 py-2 text-sm hover:bg-surface"
            >
              →
            </a>
          </div>
        }
      />

      {people.length === 0 ? (
        <EmptyState>Nobody is attached to this branch yet.</EmptyState>
      ) : (
        <AttendanceGrid
          branchId={branch.id}
          year={year}
          month={month}
          people={people.map((p) => ({ id: p.id, name: p.fullName, employeeId: p.employeeId }))}
          cells={cells}
          locked={Boolean(sheet && sheet.status !== "OPEN")}
          remaining={remaining}
        />
      )}
    </main>
  );
}
