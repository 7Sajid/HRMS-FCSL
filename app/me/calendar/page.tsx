import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/auth";
import {
  calendarDate,
  dayKind,
  daysInMonth,
  formatDate,
  formatDateTime,
  formatMonth,
  toISODate,
  todayInDhaka,
} from "@/lib/dates";
import { calendarFor } from "@/lib/leave-service";
import { Card, PageHeader } from "@/components/ui/Card";
import { Notes } from "@/components/me/Notes";

export const metadata = { title: "Calendar & notes · FCSL HR" };

type Props = { searchParams: Promise<{ m?: string }> };

/**
 * §6, "Calendar and notes" — public holidays, the Friday–Saturday weekly off,
 * the person's own approved leave, and a private notes area nobody else can
 * read at any level, the Super Admin included.
 */
export default async function Page({ searchParams }: Props) {
  const { employee, user } = await requireEmployee();
  const today = todayInDhaka();

  const requested = (await searchParams).m;
  const [yearStr, monthStr] = (requested ?? "").split("-");
  const year = Number(yearStr) || today.getUTCFullYear();
  const month = Number(monthStr) || today.getUTCMonth() + 1;

  const first = calendarDate(year, month, 1);
  const last = calendarDate(year, month, daysInMonth(year, month));

  const [calendar, leaveDays, holidays, events, notes] = await Promise.all([
    calendarFor(year),
    prisma.leaveDay.findMany({
      where: {
        employeeId: employee.id,
        date: { gte: first, lte: last },
        lengthDays: { gt: 0 },
        leaveRequest: { status: { in: ["PENDING", "GRANTED"] } },
      },
      include: { leaveRequest: { select: { status: true } }, leaveType: true },
    }),
    prisma.holiday.findMany({ where: { date: { gte: first, lte: last } }, orderBy: { date: "asc" } }),
    prisma.calendarEvent.findMany({
      where: {
        startsAt: { lte: new Date(last.getTime() + 86_400_000) },
        endsAt: { gte: first },
        OR: [
          { scope: "COMPANY" },
          { scope: "BRANCH", branchId: employee.branchId ?? "__none__" },
          { scope: "EMPLOYEE", employeeId: employee.id },
        ],
      },
      orderBy: { startsAt: "asc" },
    }),
    prisma.note.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);

  const leaveByDate = new Map(
    leaveDays.map((d) => [toISODate(d.date), { type: d.leaveType.name, status: d.leaveRequest.status }]),
  );
  const holidayByDate = new Map(holidays.map((h) => [toISODate(h.date), h.name]));

  // Monday-first, which is how a Bangladeshi working week reads with Friday
  // and Saturday at the end.
  const leadingBlanks = (first.getUTCDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, i) => calendarDate(year, month, i + 1)),
  ];

  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Calendar & notes"
        subtitle="Holidays, your weekly off, your own leave — and a notepad only you can read."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem] [&>*]:min-w-0">
        <div>
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <a
                href={`/me/calendar?m=${previous}`}
                className="rounded-lg px-2 py-1 text-sm text-ink-500 hover:bg-surface"
                aria-label="Previous month"
              >
                ←
              </a>
              <h2 className="text-sm font-semibold text-ink-900">{formatMonth(year, month)}</h2>
              <a
                href={`/me/calendar?m=${next}`}
                className="rounded-lg px-2 py-1 text-sm text-ink-500 hover:bg-surface"
                aria-label="Next month"
              >
                →
              </a>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-400">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <div key={d} className="pb-1 font-medium">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {cells.map((date, index) => {
                if (!date) return <div key={`blank-${index}`} />;
                const iso = toISODate(date);
                const kind = dayKind(date, calendar.holidays, calendar.weeklyOffDays);
                const leave = leaveByDate.get(iso);
                const holidayName = holidayByDate.get(iso);
                const isToday = iso === toISODate(today);

                let tone = "bg-white text-ink-900";
                if (kind === "WEEKLY_OFF") tone = "bg-surface text-ink-400";
                if (kind === "HOLIDAY") tone = "bg-warn-50 text-warn-500";
                if (leave)
                  tone =
                    leave.status === "GRANTED"
                      ? "bg-brand-50 text-brand-500"
                      : "bg-brand-50/50 text-brand-400";

                return (
                  <div
                    key={iso}
                    className={`min-h-[64px] rounded-lg border p-1.5 text-left ${tone} ${
                      isToday ? "border-brand-500" : "border-ink-300/30"
                    }`}
                  >
                    <div className="text-xs font-medium">{date.getUTCDate()}</div>
                    {holidayName && <div className="mt-0.5 text-[10px] leading-tight">{holidayName}</div>}
                    {leave && (
                      <div className="mt-0.5 text-[10px] leading-tight">
                        {leave.type}
                        {leave.status === "PENDING" ? " (applied)" : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-ink-500">
              <Key className="bg-surface" label="Weekly off — Friday and Saturday" />
              <Key className="bg-warn-50" label="Public holiday" />
              <Key className="bg-brand-50" label="Your leave" />
            </div>
          </Card>

          {events.length > 0 && (
            <Card className="mt-4 p-5">
              <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">ANNOUNCEMENTS</h2>
              <ul className="space-y-3">
                {events.map((event) => (
                  <li key={event.id}>
                    <p className="text-sm font-medium text-ink-900">{event.title}</p>
                    <p className="text-xs text-ink-500">{formatDateTime(event.startsAt)}</p>
                    {event.body && <p className="mt-1 text-sm text-ink-700">{event.body}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {holidays.length > 0 && (
            <Card className="mt-4 p-5">
              <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
                HOLIDAYS THIS MONTH
              </h2>
              <ul className="space-y-1 text-sm">
                {holidays.map((holiday) => (
                  <li key={holiday.id} className="flex justify-between">
                    <span className="text-ink-900">{holiday.name}</span>
                    <span className="text-ink-500">
                      {formatDate(holiday.date)}
                      {holiday.halfDay ? " (half day)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div>
          <Card className="p-5">
            <h2 className="text-xs font-semibold tracking-widest text-ink-400">MY NOTES</h2>
            <p className="mb-4 mt-2 text-xs text-ink-500">
              Private to you. Nobody else can read these — not your manager, not HR, not the Super
              Admin.
            </p>
            <Notes
              notes={notes.map((n) => ({
                id: n.id,
                body: n.body,
                updatedAt: formatDateTime(n.updatedAt),
              }))}
            />
          </Card>
        </div>
      </div>
    </main>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-3 w-3 rounded ${className} border border-ink-300/40`} />
      {label}
    </span>
  );
}
