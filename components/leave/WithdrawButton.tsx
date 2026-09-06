"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawLeave } from "@/app/actions/leave";

export function WithdrawButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError("");
            const result = await withdrawLeave(id);
            if ("error" in result) setError(result.error);
            else router.refresh();
          })
        }
        className="rounded-lg border border-ink-300/60 bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface disabled:opacity-60"
      >
        {pending ? "…" : label}
      </button>
      {error && (
        <span className="text-xs text-red-600" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
