"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearItem, completeExit, recordExit } from "@/app/actions/hr-exit";
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
