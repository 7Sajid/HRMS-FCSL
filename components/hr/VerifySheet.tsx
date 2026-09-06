"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceMark } from "@prisma/client";
import { correctEntry, publishSheet } from "@/app/actions/hr-attendance";
import { MARKS, MARK_LABEL } from "@/lib/attendance";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Badge, ErrorBox, NoticeBox } from "@/components/ui/Feedback";

export type VerifyRow = {
  id: string;
  employeeName: string;
  employeeId: string | null;
  date: string;
  mark: AttendanceMark;
  /** Set when the leave register says something different from the sheet. */
  conflict: string | null;
  corrections: { previous: string; next: string; reason: string; by: string; at: string }[];
};

/**
 * HR checks the sheet against the leave records and corrects with a reason.
 *
 * Only rows worth looking at are shown by default — a month is thirty days
 * times everybody in the branch, and a screen that shows all of it is a screen
 * nobody reads.
 */
export function VerifySheet({
  sheetId,
  rows,
  published,
  totals,
}: {
  sheetId: string;
  rows: VerifyRow[];
  published: boolean;
  totals: Record<string, number>;
}) {
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [mark, setMark] = useState<AttendanceMark>("PRESENT");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const interesting = rows.filter(
    (row) => row.conflict || row.corrections.length > 0 || row.mark === "ABSENT" || row.mark === "LATE",
  );
  const visible = showAll ? rows : interesting;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        {MARKS.filter((m) => totals[m.value]).map((m) => (
          <div key={m.value} className="rounded-xl border border-ink-300/40 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-ink-400">{m.label}</p>
            <p className="mt-1 text-2xl font-bold tabular text-ink-900">{totals[m.value] ?? 0}</p>
          </div>
        ))}
      </div>

      {rows.some((r) => r.conflict) && (
        <NoticeBox tone="warn">
          {rows.filter((r) => r.conflict).length} entr
          {rows.filter((r) => r.conflict).length === 1 ? "y disagrees" : "ies disagree"} with the
          leave register. Those are listed first.
        </NoticeBox>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="overflow-x-auto rounded-xl border border-ink-300/40 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink-300/40 bg-surface text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Marked</th>
              <th className="px-5 py-3 font-medium">Notes</th>
              {!published && <th className="px-5 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-300/20">
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-ink-400">
                  Nothing needs a second look. Every day is present, on leave, or a non-working day.
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr key={row.id} className={row.conflict ? "bg-warn-50/40" : undefined}>
                <td className="px-5 py-3">
                  <span className="text-ink-900">{row.employeeName}</span>
                  {row.employeeId && (
                    <span className="ml-2 text-xs text-ink-400">{row.employeeId}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3">{row.date}</td>
                <td className="px-5 py-3">{MARK_LABEL[row.mark]}</td>
                <td className="px-5 py-3">
                  {row.conflict && <p className="text-xs text-warn-500">{row.conflict}</p>}
                  {row.corrections.map((correction, i) => (
                    <p key={i} className="text-xs text-ink-500">
                      {/* The original stays readable for ever beside the change. */}
                      Was {MARK_LABEL[correction.previous as AttendanceMark]} · changed to{" "}
                      {MARK_LABEL[correction.next as AttendanceMark]} by {correction.by} on{" "}
                      {correction.at} — {correction.reason}
                    </p>
                  ))}
                </td>
                {!published && (
                  <td className="px-5 py-3">
                    {editing === row.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          className="w-40 py-1.5 text-xs"
                          value={mark}
                          onChange={(e) => setMark(e.target.value as AttendanceMark)}
                        >
                          {MARKS.map((m) => (
                            <option key={m.value} value={m.value}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                        <Input
                          className="w-48 py-1.5 text-xs"
                          placeholder="Why"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                        <Button
                          className="px-3 py-1.5 text-xs"
                          disabled={pending || reason.trim().length < 5}
                          onClick={() =>
                            startTransition(async () => {
                              const result = await correctEntry(row.id, mark, reason);
                              if ("error" in result) setError(result.error);
                              else {
                                setEditing(null);
                                setReason("");
                                router.refresh();
                              }
                            })
                          }
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          className="px-2 py-1.5 text-xs"
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => {
                          setEditing(row.id);
                          setMark(row.mark);
                          setReason("");
                        }}
                      >
                        Correct
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-ink-500 hover:text-ink-900"
        >
          {showAll
            ? `Show only what needs a look (${interesting.length})`
            : `Show every entry (${rows.length})`}
        </button>
      </div>

      {published ? (
        <NoticeBox tone="success">
          Published. Everybody in this branch can see their own month, and the sheet is closed.
        </NoticeBox>
      ) : (
        <div className="space-y-2">
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await publishSheet(sheetId);
                if ("error" in result) setError(result.error);
                else router.refresh();
              })
            }
          >
            Publish the month
          </Button>
          <p className="text-xs text-ink-400">
            Until you publish, everybody&rsquo;s own page reads &ldquo;Not yet published&rdquo;.
          </p>
        </div>
      )}
    </div>
  );
}
