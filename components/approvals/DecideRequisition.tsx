"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideRequisitionAction } from "@/app/actions/requisition-decide";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function DecideRequisition({
  id,
  isFinalStep,
  /**
   * The departments the HR Head may send this to. Empty for everybody else:
   * naming the department is the HR Head's decision alone (FCSL, 1 October
   * 2026), and the Super Admin sees the name they chose rather than a second
   * chance to change it.
   */
  departments = [],
  assignedDepartment = "",
}: {
  id: string;
  isFinalStep: boolean;
  departments?: readonly { id: string; name: string }[];
  assignedDepartment?: string;
}) {
  const router = useRouter();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Only asked for when this actor is the one who decides it and it is not
  // already settled — a requisition the HR Head is seeing a second time keeps
  // the department it was given unless they pick another.
  const mustChoose = departments.length > 0 && !assignedDepartment && !department;

  const decide = (decision: "APPROVE" | "DENY") =>
    startTransition(async () => {
      setError("");
      const result = await decideRequisitionAction(id, decision, reason, department || null);
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
    <div className="w-full max-w-[14rem] space-y-2">
      {error && <ErrorBox>{error}</ErrorBox>}
      {departments.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">Who actions it</span>
          <Select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="text-xs"
          >
            <option value="">{assignedDepartment || "Choose a department…"}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div className="flex gap-2">
        <Button
          className="px-3 py-1.5 text-xs"
          disabled={pending || mustChoose}
          onClick={() => decide("APPROVE")}
        >
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
      <p className="text-xs text-ink-400">
        {mustChoose
          ? "Say who will action it first."
          : isFinalStep
            ? "Approving finishes this. Whoever actions it is told."
            : "Approving passes it to the Super Admin."}
      </p>
    </div>
  );
}
