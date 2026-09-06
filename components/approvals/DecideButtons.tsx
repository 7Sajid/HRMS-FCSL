"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideLeave } from "@/app/actions/approvals";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

/**
 * Grant or Deny. A denial opens a reason box first and will not submit without
 * one — §5.2: "the system will not accept an empty one."
 */
export function DecideButtons({ id, isFinalStep }: { id: string; isFinalStep: boolean }) {
  const router = useRouter();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const decide = (decision: "GRANT" | "DENY") =>
    startTransition(async () => {
      setError("");
      const result = await decideLeave(id, decision, reason);
      if ("error" in result) setError(result.error);
      else {
        setDenying(false);
        setReason("");
        router.refresh();
      }
    });

  if (denying) {
    return (
      <div className="space-y-2">
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this being denied? They see exactly what you write."
          autoFocus
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex gap-2">
          <Button
            variant="danger"
            className="px-3 py-1.5 text-xs"
            disabled={pending || reason.trim().length < 5}
            onClick={() => decide("DENY")}
          >
            {pending ? "…" : "Confirm denial"}
          </Button>
          <Button
            variant="ghost"
            className="px-3 py-1.5 text-xs"
            disabled={pending}
            onClick={() => {
              setDenying(false);
              setError("");
            }}
          >
            Cancel
          </Button>
        </div>
        <p className="text-xs text-ink-400">
          {/* Rule 2, stated where the decision is made rather than in a manual. */}
          Denying ends the application here. Nobody above you is told.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button className="px-3 py-1.5 text-xs" disabled={pending} onClick={() => decide("GRANT")}>
          {pending ? "…" : "Grant"}
        </Button>
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          disabled={pending}
          onClick={() => setDenying(true)}
        >
          Deny
        </Button>
      </div>
      <p className="text-xs text-ink-400">
        {isFinalStep
          ? "Granting finishes this — the days come off their balance."
          : "Granting passes it on. It is not finished yet."}
      </p>
    </div>
  );
}
