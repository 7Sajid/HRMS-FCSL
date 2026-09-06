"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideContactChange, resolveCorrection } from "@/app/actions/hr-setup";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function ContactChange({
  id,
  proposed,
  currentValue,
}: {
  id: string;
  proposed: string;
  currentValue: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const decide = (approve: boolean) =>
    startTransition(async () => {
      const result = await decideContactChange(id, approve, reason);
      if ("error" in result) setError(result.error);
      else router.refresh();
    });

  return (
    <div className="rounded-lg border border-warn-500/50 bg-warn-50/40 p-4">
      <p className="text-xs font-semibold tracking-widest text-ink-400">CHANGE WAITING</p>
      <p className="mt-2 text-sm text-ink-500">
        Now: <span className="text-ink-900">{currentValue || "nothing on file"}</span>
      </p>
      <p className="text-sm text-ink-500">
        Proposed: <span className="font-medium text-ink-900">{proposed}</span>
      </p>
      {error && (
        <div className="mt-2">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button className="px-3 py-1.5 text-xs" disabled={pending} onClick={() => decide(true)}>
          Approve
        </Button>
        <Input
          className="max-w-xs py-1.5 text-xs"
          placeholder="Reason, if refusing"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          disabled={pending || reason.trim().length < 5}
          onClick={() => decide(false)}
        >
          Refuse
        </Button>
      </div>
    </div>
  );
}

export function CorrectionRequestRow({ id, message }: { id: string; message: string }) {
  const router = useRouter();
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const decide = (resolved: boolean) =>
    startTransition(async () => {
      const result = await resolveCorrection(id, resolved, response);
      if ("error" in result) setError(result.error);
      else router.refresh();
    });

  return (
    <div className="rounded-lg border border-ink-300/40 bg-white p-4">
      <p className="text-sm text-ink-900">{message}</p>
      {error && (
        <div className="mt-2">
          <ErrorBox>{error}</ErrorBox>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm py-1.5 text-xs"
          placeholder="What you did, or why not"
          value={response}
          onChange={(e) => setResponse(e.target.value)}
        />
        <Button className="px-3 py-1.5 text-xs" disabled={pending} onClick={() => decide(true)}>
          Done
        </Button>
        <Button
          variant="secondary"
          className="px-3 py-1.5 text-xs"
          disabled={pending || response.trim().length < 5}
          onClick={() => decide(false)}
        >
          Not changing it
        </Button>
      </div>
    </div>
  );
}
