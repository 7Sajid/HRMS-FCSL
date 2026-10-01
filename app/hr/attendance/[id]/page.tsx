import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate, formatDateTime, formatMonth, toISODate } from "@/lib/dates";
import { MARK_LABEL } from "@/lib/attendance";
import { PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { VerifySheet, type VerifyRow } from "@/components/hr/VerifySheet";

type Props = { params: Promise<{ id: string }> };

/**
 * §6.3 — "HR checks the sheets against leave records, queries anything odd,
 * corrects with a reason recorded, then publishes the month."
 *
 * Checking against the leave register is done here rather than left to the
 * eye: every entry that disagrees with an approved leave day is flagged.
 */
export default async function Page({ params }: Props) {
  await requireCapability("attendance.verify");
  const { id } = await params;

  const sheet = await prisma.attendanceSheet.findUnique({
    where: { id },
    include: {
      branch: true,
      entries: {
        include: {
          employee: { select: { fullName: true, employeeId: true } },
          corrections: { orderBy: { correctedAt: "asc" } },
        },
        orderBy: [{ date: "asc" }],
      },
    },
  });
  if (!sheet) notFound();

  const first = new Date(Date.UTC(sheet.year, sheet.month - 1, 1));
  const last = new Date(Date.UTC(sheet.year, sheet.month, 0));

  const leaveDays = await prisma.leaveDay.findMany({
    where: {
      date: { gte: first, lte: last },
      lengthDays: { gt: 0 },
      leaveRequest: { status: "GRANTED" },
      employeeId: { in: [...new Set(sheet.entries.map((e) => e.employeeId))] },
    },
    select: { employeeId: true, date: true },
  });
  const onLeave = new Set(leaveDays.map((d) => `${d.employeeId}:${toISODate(d.date)}`));

  const totals: Record<string, number> = {};
  for (const entry of sheet.entries) totals[entry.mark] = (totals[entry.mark] ?? 0) + 1;

  const rows: VerifyRow[] = sheet.entries.map((entry) => {
    const key = `${entry.employeeId}:${toISODate(entry.date)}`;
    const hasLeave = onLeave.has(key);
    // The one disagreement worth catching: the leave register says they were
    // away and the sheet says otherwise.
    const conflict =
      hasLeave && entry.mark !== "ON_LEAVE"
        ? `Approved leave on this day, but marked ${MARK_LABEL[entry.mark].toLowerCase()}.`
        : null;

    return {
      id: entry.id,
      employeeName: entry.employee.fullName,
      employeeId: entry.employee.employeeId,
      date: formatDate(entry.date),
      mark: entry.mark,
      conflict,
      corrections: entry.corrections.map((c) => ({
        previous: c.previousMark,
        next: c.newMark,
        reason: c.reason,
        by: c.correctedByName,
        at: formatDate(c.correctedAt),
      })),
    };
  });

  // Conflicts first — they are why this screen exists.
  rows.sort((a, b) => Number(Boolean(b.conflict)) - Number(Boolean(a.conflict)));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        eyebrow={sheet.branch.name.toUpperCase()}
        title={`Branch attendance — ${formatMonth(sheet.year, sheet.month)}`}
        subtitle={`Submitted by ${sheet.submittedByName} on ${formatDateTime(sheet.submittedAt)}`}
        actions={
          <div className="flex items-center gap-2">
            {sheet.status === "PUBLISHED" ? (
              <Badge tone="success">Published</Badge>
            ) : (
              <Badge tone="warn">Waiting for you</Badge>
            )}
            <Link
              href="/hr/attendance"
              className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
            >
              Back
            </Link>
          </div>
        }
      />

      <VerifySheet
        sheetId={sheet.id}
        rows={rows}
        published={sheet.status === "PUBLISHED"}
        totals={totals}
      />
    </main>
  );
}
