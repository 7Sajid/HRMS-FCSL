"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearItem, completeExit, recordExit, reverseExit } from "@/app/actions/hr-exit";
import { EXIT_REASONS } from "@/lib/exit";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

export function RecordExitForm({ employeeId }: { employeeId: string }) {
  const [state, formAction, pending] = useActionState(recordExit.bind(null, employeeId), null);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Why are they leaving" htmlFor="reason" required>
          <Select id="reason" name="reason" defaultValue="RESIGNATION">
            {EXIT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Last working day"
          htmlFor="lastWorkingDay"
          required
          hint="Their access closes at the end of this day."
        >
          <Input id="lastWorkingDay" name="lastWorkingDay" type="date" required />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note" htmlFor="reasonNote">
            <Textarea id="reasonNote" name="reasonNote" rows={2} />
          </Field>
        </div>
      </div>

      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}

      <Button type="submit" disabled={pending}>
        {pending ? "Recording…" : "Record the departure"}
      </Button>
      <p className="text-xs text-ink-400">
        Recording is not finishing. A clearance checklist opens, and the exit stays open until every
        line is ticked and any trading terminal is surrendered.
      </p>
    </form>
  );
}

export function ClearanceItem({
  id,
  label,
  area,
  clearedBy,
  clearedAt,
  note,
  locked,
}: {
  id: string;
  label: string;
  area: string;
  clearedBy: string;
  clearedAt: string | null;
  note: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(note);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
      <input
        type="checkbox"
        checked={Boolean(clearedAt)}
        disabled={locked || pending}
        aria-label={label}
        onChange={() =>
          startTransition(async () => {
            await clearItem(id, text);
            router.refresh();
          })
        }
        className="h-4 w-4 accent-brand-500"
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${clearedAt ? "text-ink-400 line-through" : "text-ink-900"}`}>
          {label}
        </p>
        <p className="text-xs text-ink-400">
          {area}
          {clearedAt ? ` · cleared by ${clearedBy} on ${clearedAt}` : ""}
        </p>
      </div>
      {!locked && (
        <Input
          className="max-w-[14rem] py-1.5 text-xs"
          placeholder="Note"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
    </div>
  );
}

export function CompleteExitButton({
  employeeId,
  blockers,
}: {
  employeeId: string;
  blockers: string[];
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {blockers.length > 0 && (
        <NoticeBox tone="warn">
          <p className="font-medium">This exit cannot be finished yet.</p>
          <ul className="mt-1 list-inside list-disc">
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </NoticeBox>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button
        disabled={pending || blockers.length > 0}
        onClick={() =>
          startTransition(async () => {
            const result = await completeExit(employeeId);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Finishing…" : "Finish the exit and mark them Left"}
      </Button>
      <p className="text-xs text-ink-400">
        Their certificate is surrendered, their access closes, and their employee ID is marked Left.
        The record itself is kept for ever.
      </p>
    </div>
  );
}


/**
 * §6.6 — undo an exit.
 *
 * A resignation withdrawn, or one recorded against the wrong person. Asks for
 * a reason and says plainly what it does and does not do: the record comes
 * back, the login does not. §5.5 keeps re-opening an account with the Super
 * Admin, so this screen ends by naming the next step rather than pretending
 * the person can sign in again.
 */
export function ReverseExitButton({
  employeeId,
  fullName,
  wasCompleted,
}: {
  employeeId: string;
  fullName: string;
  wasCompleted: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  if (!asking) {
    return (
      <Button variant="secondary" onClick={() => setAsking(true)}>
        Undo this exit
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBox>{error}</ErrorBox>}
      <NoticeBox tone="warn">
        <p>
          {fullName} goes back to <strong className="font-medium">Active</strong>
          {wasCompleted ? ", and their RM certificate comes back with them" : ""}. The exit stays on
          the permanent record, marked undone.
        </p>
        <p className="mt-2">
          <strong className="font-medium">Their login stays closed.</strong> Only the Super Admin
          re-opens an account — ask them once this is done.
        </p>
      </NoticeBox>
      <Field label="Why is it being undone?" htmlFor={`why-${employeeId}`} required>
        <Textarea
          id={`why-${employeeId}`}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="They withdrew their resignation on 8 September."
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await reverseExit(employeeId, reason);
              if ("error" in result) setError(result.error);
              else {
                setError("");
                setAsking(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Undoing…" : "Undo the exit"}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setAsking(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
