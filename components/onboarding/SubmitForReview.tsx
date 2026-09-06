"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitForReview } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/Button";
import { ErrorBox } from "@/components/ui/Feedback";

export function SubmitForReview({ canSubmit, missing }: { canSubmit: boolean; missing: string[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-3">
      {!canSubmit && missing.length > 0 && (
        <div className="rounded-lg bg-warn-50 px-4 py-3 text-sm text-ink-700">
          <p className="font-medium text-warn-500">Still needed before you can submit</p>
          <ul className="mt-1 list-inside list-disc text-ink-500">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}

      <Button
        type="button"
        disabled={!canSubmit || pending}
        onClick={() =>
          startTransition(async () => {
            setError("");
            const result = await submitForReview();
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
      >
        {pending ? "Sending to HR…" : "Submit to HR"}
      </Button>

      <p className="text-xs text-ink-400">
        HR checks your file and then your panel opens. If anything needs re-doing they send back only
        that item, with a reason.
      </p>
    </div>
  );
}
