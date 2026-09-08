"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawRequisition } from "@/app/actions/requisitions";
import { markFulfilled } from "@/app/actions/requisition-decide";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

/**
 * §6.2's withdrawal and §6.4's "ends with", neither of which had a button.
 *
 * Both actions existed, guarded and audited, and no screen called either — so
 * the tracking table rendered "Withdrawn" and "Delivered" badges for two
 * states nothing in the software could reach.
 */
export function WithdrawRequisition({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");

  if (!asking) {
    return (
      <button
        type="button"
        className="text-xs text-ink-500 underline hover:text-ink-900"
        onClick={() => setAsking(true)}
      >
        Withdraw
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-700">Take it out of their inbox?</span>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await withdrawRequisition(id);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Withdrawing…" : "Yes"}
      </Button>
      <button
        type="button"
        className="text-xs text-ink-500 underline hover:text-ink-900"
        onClick={() => setAsking(false)}
      >
        Keep it
      </button>
      {error && <ErrorBox>{error}</ErrorBox>}
    </span>
  );
}

/** §6.4 — "ends with": Admin, IT or Accounts records that it arrived. */
export function MarkDelivered({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-56 py-1.5 text-xs"
        placeholder="What arrived, and when"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await markFulfilled(id, note);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Recording…" : "Mark delivered"}
      </Button>
      {error && <ErrorBox>{error}</ErrorBox>}
    </div>
  );
}
