"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { applyForLeave } from "@/app/actions/leave";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

export type TypeOption = {
  id: string;
  name: string;
  applicable: number;
  available: number;
  pending: number;
  attachmentRequiredAfterDays: number | null;
};

/**
 * §6.2: "Before they press send the system already tells them three things:
 * how many WORKING days this costs, how many days of that type they have left,
 * and who the application is going to first. No surprises after the fact."
 *
 * The working-day count is computed here from the same holiday list and weekly
 * off the server uses, so the preview and the decision cannot disagree.
 */
export type AttachmentOption = { id: string; label: string };

export function ApplyForLeave({
  types,
  goesTo,
  holidays,
  halfDayHolidays,
  weeklyOffDays,
  today,
  attachments,
}: {
  types: TypeOption[];
  goesTo: string;
  holidays: string[];
  halfDayHolidays: string[];
  weeklyOffDays: number[];
  today: string;
  /** The applicant's OWN uploaded files. The server re-checks ownership. */
  attachments: AttachmentOption[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(applyForLeave, null);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (state && "ok" in state) {
      setFrom("");
      setTo("");
      router.refresh();
    }
  }, [state, router]);

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const halfSet = useMemo(() => new Set(halfDayHolidays), [halfDayHolidays]);

  const cost = useMemo(() => {
    if (!from || !to || to < from) return null;
    let total = 0;
    let calendarDays = 0;
    for (const iso of datesBetween(from, to)) {
      calendarDays += 1;
      const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
      if (weeklyOffDays.includes(day)) continue;
      if (holidaySet.has(iso)) continue;
      total += halfSet.has(iso) ? 0.5 : 1;
    }
    return { working: total, calendarDays };
  }, [from, to, holidaySet, halfSet, weeklyOffDays]);

  const type = types.find((t) => t.id === typeId);
  const late = Boolean(from && from < today);
  const overBalance = Boolean(type && cost && cost.working > type.applicable);
  const needsCertificate = Boolean(
    type?.attachmentRequiredAfterDays !== null &&
      type?.attachmentRequiredAfterDays !== undefined &&
      cost &&
      cost.working > type.attachmentRequiredAfterDays,
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Leave type" htmlFor="leaveTypeId" required>
        <Select
          id="leaveTypeId"
          name="leaveTypeId"
          value={typeId}
          onChange={(e) => setTypeId(e.target.value)}
          required
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.applicable} day{t.applicable === 1 ? "" : "s"} left
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First day" htmlFor="from" required>
          <Input id="from" name="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label="Last day" htmlFor="to" required>
          <Input id="to" name="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} min={from} required />
        </Field>
      </div>

      {cost && (
        <NoticeBox tone={overBalance ? "warn" : "brand"}>
          <p>
            <strong className="font-medium">
              {cost.calendarDays} calendar day{cost.calendarDays === 1 ? "" : "s"}, costing{" "}
              {cost.working} working day{cost.working === 1 ? "" : "s"}.
            </strong>{" "}
            Fridays, Saturdays and public holidays are not counted.
          </p>
          {type && (
            <p className="mt-1">
              You have {type.applicable} day{type.applicable === 1 ? "" : "s"} of {type.name.toLowerCase()} left
              {type.pending > 0 ? ` (${type.pending} already applied for and waiting)` : ""}.
            </p>
          )}
          <p className="mt-1">This goes to {goesTo} first.</p>
        </NoticeBox>
      )}

      {needsCertificate && (
        // The notice used to say "upload it on your documents page first, then
        // apply" and then gave no way to point at it, so the pre-flight check
        // could never be satisfied through this screen. The list is the
        // person's own files; the server checks that again before saving.
        <>
          <NoticeBox tone="warn">
            Leave of more than {type?.attachmentRequiredAfterDays} days of this type needs a medical
            certificate.
            {attachments.length === 0 && " Upload it on your documents page first, then come back."}
          </NoticeBox>
          {attachments.length > 0 && (
            <Field
              label="Which document is the certificate?"
              htmlFor="attachmentId"
              hint="Your own uploaded files."
              required
            >
              <Select id="attachmentId" name="attachmentId" defaultValue="" required>
                <option value="" disabled>
                  Choose a file
                </option>
                {attachments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}

      <Field label="Reason" htmlFor="reason" required>
        <Textarea id="reason" name="reason" rows={2} required minLength={3} />
      </Field>

      {late && (
        <Field
          label="Why is this application late?"
          htmlFor="lateReason"
          hint="These dates have already started."
          required
        >
          <Input id="lateReason" name="lateReason" required />
        </Field>
      )}

      {state && "error" in state && (
        <div className="space-y-2">
          {(state.problems ?? [state.error]).map((problem) => (
            <ErrorBox key={problem}>{problem}</ErrorBox>
          ))}
        </div>
      )}
      {state && "ok" in state && (
        <>
          <p className="text-sm text-success-500">Applied. It is on its way.</p>
          {state.warnings.map((w) => (
            <NoticeBox key={w} tone="warn">
              {w}
            </NoticeBox>
          ))}
        </>
      )}

      <Button type="submit" disabled={pending || !types.length}>
        {pending ? "Sending…" : "Apply for leave"}
      </Button>
    </form>
  );
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}
