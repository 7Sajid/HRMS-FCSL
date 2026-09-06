"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closeShowCause } from "@/app/actions/compliance";
import { OUTCOMES } from "@/lib/showcause";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function CloseShowCauseForm({ id, hasReplied }: { id: string; hasReplied: boolean }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState<"NO_ACTION" | "WARNING" | "ESCALATED">("NO_ACTION");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {!hasReplied && (
        <p className="text-xs text-warn-500">
          They have not replied yet. Until they do, closing with no action is the only outcome
          available — a warning issued before somebody has answered is not a process.
        </p>
      )}
      <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
        {OUTCOMES.map((o) => (
          <option key={o.value} value={o.value} disabled={!hasReplied && o.value !== "NO_ACTION"}>
            {o.label}
          </option>
        ))}
      </Select>
      <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="The outcome, in your words. They see this." />
      {error && <ErrorBox>{error}</ErrorBox>}
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await closeShowCause(id, outcome, note);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Closing…" : "Record the outcome"}
      </Button>
    </div>
  );
}
