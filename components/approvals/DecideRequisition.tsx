"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideRequisitionAction } from "@/app/actions/requisition-decide";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function DecideRequisition({ id, isFinalStep }: { id: string; isFinalStep: boolean }) {
  const router = useRouter();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const decide = (decision: "APPROVE" | "DENY") =>
    startTransition(async () => {
      setError("");
      const result = await decideRequisitionAction(id, decision, reason);
      if ("error" in result) setError(result.error);
      else {
        setDenying(false);
        setReason("");
        router.refresh();
      }
    });

  if (denying) {
    return (
      <div className="w-full max-w-sm space-y-2">
        <Textarea
          rows={2}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this being denied? They see exactly what you write."
        />
        {error && <ErrorBox>{error}</ErrorBox>}
        <div className="flex gap-2">
          <Button
            variant="danger"
            className="px-3 py-1.5 text-xs"
            disabled={pending || reason.trim().length < 5}
            onClick={() => decide("DENY")}
          >
            Confirm denial
          </Button>
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => setDenying(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex gap-2">
        <Button className="px-3 py-1.5 text-xs" disabled={pending} onClick={() => decide("APPROVE")}>
          Approve
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
      <p className="max-w-[12rem] text-xs text-ink-400">
        {isFinalStep ? "Approving finishes this." : "Approving passes it to the Super Admin."}
      </p>
    </div>
  );
}
