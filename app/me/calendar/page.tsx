import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireOpenPanel } from "@/lib/auth";
import {
  calendarDate,
  dayKind,
  daysInMonth,
  formatDate,
  formatDateTime,
  formatMonth,
  fromISODate,
  toISODate,
  todayInDhaka,
} from "@/lib/dates";
import { calendarFor } from "@/lib/leave-service";
import { Card, PageHeader } from "@/components/ui/Card";
import { NoteForm, NoteList } from "@/components/me/Notes";

export const metadata = { title: "Calendar & notes · FCSL HR" };

type Props = { searchParams: Promise<{ m?: string; d?: string }> };

/**
 * §6, "Calendar and notes" — public holidays, the Friday–Saturday weekly off,
 * the person's own approved leave, and a private notes area nobody else can
 * read at any level, the Super Admin included.
 *
 * FCSL, 10 September 2026: every note is written for a day. Pick a day on the
 * calendar and the note goes against it; the day shows that it holds notes, and
 * that morning the bell says so (`runNoteReminders` in lib/jobs.ts).
 *
 * Every panel carries this page, so it asks for an open panel rather than an
 * employee record. The first Super Admin has none: they get the company's
 * holidays and announcements and their own notes, and no leave.
 */
export default async function Page({ searchParams }: Props) {
  const { employee, user } = await requireOpenPanel();
  const today = todayInDhaka();

  const params = await searchParams;
  const picked = fromISODate(params.d);
  const [yearStr, monthStr] = (params.m ?? "").split("-");
  // The month asked for; otherwise the picked day's month; otherwise this one.
  const year = Number(yearStr) || picked?.getUTCFullYear() || today.getUTCFullYear();
  const month = Number(monthStr) || (picked ? picked.getUTCMonth() + 1 : today.getUTCMonth() + 1);

  const first = calendarDate(year, month, 1);
  const last = calendarDate(year, month, daysInMonth(year, month));
  // The day the notes panel is about: the one picked if it is in this month,
  // else today if today is, else the 1st.
  const inMonth = (date: Date) => date >= first && date <= last;
  const selected = picked && inMonth(picked) ? picked : inMonth(today) ? today : first;
  const monthKey = `${year}-${String(month).padStart(2, "0")}`;
  const dayHref = (date: Date) =>
    `/me/calendar?m=${toISODate(date).slice(0, 7)}&d=${toISODate(date)}`;

  const [calendar, leaveDays, holidays, events, notesOnDay, upcoming, noteDays] = await Promise.all([
    calendarFor(year),
    prisma.leaveDay.findMany({
      where: {
        // Nobody's, for a Super Admin with no employee record.
        employeeId: employee?.id ?? "__none__",
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
          { scope: "BRANCH", branchId: employee?.branchId ?? "__none__" },
          { scope: "EMPLOYEE", employeeId: employee?.id ?? "__none__" },
        ],
      },
      orderBy: { startsAt: "asc" },
    }),
    // Every read is scoped to the person asking, in the query. There is no
    // path from this page to anybody else's notes.
    prisma.note.findMany({
      where: { userId: user.id, date: selected },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.note.findMany({
      where: { userId: user.id, date: { gte: today }, NOT: { date: selected } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      take: 10,
    }),
    prisma.note.groupBy({
      by: ["date"],
      where: { userId: user.id, date: { gte: first, lte: last } },
      _count: { _all: true },
    }),
  ]);

  const leaveByDate = new Map(
    leaveDays.map((d) => [toISODate(d.date), { type: d.leaveType.name, status: d.leaveRequest.status }]),
  );
  const holidayByDate = new Map(holidays.map((h) => [toISODate(h.date), h.name]));
  const notesByDate = new Map(noteDays.map((row) => [toISODate(row.date), row._count._all]));

  // Monday-first, which is how a Bangladeshi working week reads with Friday
  // and Saturday at the end.
  const leadingBlanks = (first.getUTCDay() + 6) % 7;
  const cells = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, i) => calendarDate(year, month, i + 1)),
  ];

  const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
  const selectedIso = toISODate(selected);
  const rows = (notes: typeof notesOnDay) =>
    notes.map((n) => ({
      id: n.id,
      body: n.body,
      date: toISODate(n.date),
      updatedAt: formatDateTime(n.updatedAt),
    }));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        title="Calendar & notes"
        subtitle={
          employee
            ? "Holidays, your weekly off, your own leave — and notes only you can read. Pick a day to write a note for it."
            : "Holidays and announcements — and notes only you can read. Pick a day to write a note for it."
        }
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
                const noteCount = notesByDate.get(iso) ?? 0;
                const isToday = iso === toISODate(today);
                const isSelected = iso === selectedIso;

                let tone = "bg-white text-ink-900";
                if (kind === "WEEKLY_OFF") tone = "bg-surface text-ink-400";
                if (kind === "HOLIDAY") tone = "bg-warn-50 text-warn-500";
                if (leave)
                  tone =
                    leave.status === "GRANTED"
                      ? "bg-brand-50 text-brand-500"
                      : "bg-brand-50/50 text-brand-400";

                const label = [
                  formatDate(date),
                  holidayName,
                  leave ? `${leave.type}${leave.status === "PENDING" ? " (applied)" : ""}` : null,
                  noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : null,
                ]
                  .filter(Boolean)
                  .join(", ");

                return (
                  <Link
                    key={iso}
                    href={dayHref(date)}
                    scroll={false}
                    aria-label={label}
                    aria-current={isSelected ? "date" : undefined}
                    className={`block min-h-[64px] rounded-lg border p-1.5 text-left transition-colors hover:border-brand-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-100 ${tone} ${
                      isSelected
                        ? "border-brand-500 ring-2 ring-brand-500/30"
                        : isToday
                          ? "border-brand-500"
                          : "border-ink-300/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-xs font-medium">{date.getUTCDate()}</span>
                      {noteCount > 0 && (
                        <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-medium leading-4 text-white">
                          {noteCount}
                        </span>
                      )}
                    </div>
                    {holidayName && <div className="mt-0.5 text-[10px] leading-tight">{holidayName}</div>}
                    {leave && (
                      <div className="mt-0.5 text-[10px] leading-tight">
                        {leave.type}
                        {leave.status === "PENDING" ? " (applied)" : ""}
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-ink-500">
              <Key className="bg-surface" label="Weekly off — Friday and Saturday" />
              <Key className="bg-warn-50" label="Public holiday" />
              {employee && <Key className="bg-brand-50" label="Your leave" />}
              <span className="inline-flex items-center gap-1.5">
                <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-medium leading-4 text-white">
                  1
                </span>
                Notes you wrote for that day
              </span>
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
              Admin. On the morning of the day, your bell reminds you.
            </p>

            <p className="mb-2 text-sm font-medium text-ink-900">
              {formatDate(selected)}
              {selectedIso === toISODate(today) ? " · today" : ""}
            </p>
            <NoteList notes={rows(notesOnDay)} emptyText="Nothing written for this day yet." />

            <div className="mt-4 border-t border-ink-300/30 pt-4">
              <NoteForm key={selectedIso} date={selectedIso} />
            </div>

            {upcoming.length > 0 && (
              <div className="mt-6 border-t border-ink-300/30 pt-4">
                <h3 className="mb-2 text-xs font-semibold tracking-widest text-ink-400">COMING UP</h3>
                <ul className="-mx-2 space-y-1">
                  {upcoming.map((note) => (
                    <li key={note.id}>
                      <Link
                        href={dayHref(note.date)}
                        scroll={false}
                        className="block rounded-lg px-2 py-1.5 hover:bg-surface"
                      >
                        <span className="text-xs font-medium text-ink-700">{formatDate(note.date)}</span>
                        <span className="block truncate text-xs text-ink-500">
                          {note.body.split("\n")[0]}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
