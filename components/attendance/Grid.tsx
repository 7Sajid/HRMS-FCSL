"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceMark } from "@prisma/client";
import { markAttendance, submitSheet } from "@/app/actions/attendance";
import { MARKS, MARK_LABEL, MARK_SHORT } from "@/lib/attendance";
import { Button } from "@/components/ui/Button";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

export type GridPerson = { id: string; name: string; employeeId: string | null };
export type GridCell = {
  iso: string;
  day: number;
  mark: AttendanceMark | null;
  locked: boolean;
  /** False before this person joined or after their last working day. */
  employed: boolean;
};

const TONE: Record<AttendanceMark, string> = {
  PRESENT: "bg-success-50 text-success-500",
  ABSENT: "bg-red-50 text-red-600",
  LATE: "bg-warn-50 text-warn-500",
  OFFICIAL_DUTY: "bg-brand-50 text-brand-500",
  ON_LEAVE: "bg-brand-50 text-brand-500",
  PUBLIC_HOLIDAY: "bg-surface text-ink-400",
  WEEKLY_OFF: "bg-surface text-ink-300",
};

const TYPEABLE = MARKS.filter((m) => !["ON_LEAVE", "PUBLIC_HOLIDAY", "WEEKLY_OFF"].includes(m.value));

/**
 * People down the side, days across the top (§6.3).
 *
 * Cells the system already knows — approved leave, Fridays, Saturdays, public
 * holidays — are filled in and cannot be clicked. A manager marking somebody
 * present on a day their leave was approved would put the attendance sheet and
 * the leave register into a disagreement nothing else can settle.
 *
 * Saves as you go rather than all at once: a month's work lost to a closed tab
 * is not a trade worth making.
 */
export function AttendanceGrid({
  branchId,
  year,
  month,
  people,
  cells,
  locked,
  remaining,
}: {
  branchId: string;
  year: number;
  month: number;
  people: GridPerson[];
  cells: Record<string, GridCell[]>;
  locked: boolean;
  remaining: number;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState<Record<string, AttendanceMark>>({});

  const set = (employeeId: string, iso: string, mark: AttendanceMark) => {
    const key = `${employeeId}:${iso}`;
    setLocal((prev) => ({ ...prev, [key]: mark }));
    setSaving(key);
    startTransition(async () => {
      const result = await markAttendance(branchId, year, month, employeeId, iso, mark);
      setSaving(null);
      if ("error" in result) {
        setError(result.error);
        // Put the cell back rather than leaving the screen showing a value the
        // database refused.
        setLocal((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } else {
        setError("");
      }
    });
  };

  // Taken from the longest row rather than the first, so the header cannot
  // disagree with a row for somebody who joined mid-month.
  const columns = Object.values(cells).reduce<GridCell[]>(
    (widest, row) => (row.length > widest.length ? row : widest),
    [],
  );

  return (
    <div className="space-y-4">
      {error && <ErrorBox>{error}</ErrorBox>}

      {locked ? (
        <NoticeBox tone="success">
          <strong className="font-medium">Submitted.</strong> This month is locked and is with HR.
          Only they can change it now, only with a reason, and you will see what they changed.
        </NoticeBox>
      ) : (
        <NoticeBox tone={remaining === 0 ? "success" : "warn"}>
          {remaining === 0
            ? "Every working day is filled in. You can submit."
            : `${remaining} working day${remaining === 1 ? "" : "s"} still to fill in. Submitting locks the month, so blanks would be locked in too.`}
        </NoticeBox>
      )}

      <div className="overflow-x-auto rounded-xl border border-ink-300/40 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-ink-300/40 bg-surface text-ink-400">
            <tr>
              <th className="sticky left-0 z-10 bg-surface px-4 py-2 font-medium">Name</th>
              {columns.map((cell) => (
                <th key={cell.iso} className="px-1 py-2 text-center font-medium tabular">
                  {cell.day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-300/20">
            {people.map((person) => (
              <tr key={person.id}>
                <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2">
                  <span className="font-medium text-ink-900">{person.name}</span>
                  {person.employeeId && <span className="ml-2 text-ink-400">{person.employeeId}</span>}
                </td>
                {(cells[person.id] ?? []).map((cell) => {
                  const key = `${person.id}:${cell.iso}`;
                  const mark = local[key] ?? cell.mark;
                  return (
                    <td key={cell.iso} className="p-0.5 text-center">
                      {!cell.employed ? (
                        <span
                          title="Not employed on this day"
                          className="inline-flex h-7 w-7 items-center justify-center rounded bg-ink-300/10 text-ink-300"
                        >
                          {"\u00a0"}
                        </span>
                      ) : cell.locked || locked ? (
                        <span
                          title={mark ? MARK_LABEL[mark] : undefined}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded ${mark ? TONE[mark] : "bg-surface text-ink-300"}`}
                        >
                          {mark ? MARK_SHORT[mark] : "·"}
                        </span>
                      ) : (
                        <select
                          aria-label={`${person.name}, day ${cell.day}`}
                          value={mark ?? ""}
                          disabled={pending && saving === key}
                          onChange={(e) => set(person.id, cell.iso, e.target.value as AttendanceMark)}
                          className={`h-7 w-7 cursor-pointer appearance-none rounded text-center text-xs outline-none focus:ring-2 focus:ring-brand-100 ${
                            mark ? TONE[mark] : "bg-white text-ink-300 ring-1 ring-inset ring-ink-300/40"
                          }`}
                        >
                          <option value="" disabled>
                            ·
                          </option>
                          {TYPEABLE.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.short} — {m.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-ink-500">
        {MARKS.map((m) => (
          <span key={m.value} className="inline-flex items-center gap-1.5">
            <span className={`inline-flex h-4 w-4 items-center justify-center rounded ${TONE[m.value]}`}>
              {m.short}
            </span>
            {m.label}
          </span>
        ))}
      </div>

      {!locked && (
        <Button
          disabled={pending || remaining > 0}
          onClick={() =>
            startTransition(async () => {
              const result = await submitSheet(branchId, year, month);
              if ("error" in result) setError(result.error);
              else router.refresh();
            })
          }
        >
          Submit the month to HR
        </Button>
      )}
    </div>
  );
}
