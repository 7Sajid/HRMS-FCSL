"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adjustLeaveBalance } from "@/app/actions/hr-setup";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

/**
 * §6.2 — correct somebody's balance.
 *
 * Goes in as a new dated bucket rather than an edit, so last year's arithmetic
 * still comes out the same and the register can always say who changed what
 * and why. Negative is allowed and is the point: it is what squares the books
 * after leave has been granted beyond entitlement, which the system records as
 * a shortfall and could not previously close.
 */
export function AdjustLeave({
  employeeId,
  year,
  types,
}: {
  employeeId: string;
  year: number;
  types: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Adjust a balance
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      {error && <ErrorBox>{error}</ErrorBox>}
      <NoticeBox tone="brand">
        This is recorded as a dated adjustment for {year}, never as an edit to what was granted.
        They are told, and the reason you write is what they see.
      </NoticeBox>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Leave type" htmlFor={`adj-type-${employeeId}`} required>
          <Select
            id={`adj-type-${employeeId}`}
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
          >
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Days"
          htmlFor={`adj-days-${employeeId}`}
          hint="Negative takes days away."
          required
        >
          <Input
            id={`adj-days-${employeeId}`}
            type="number"
            step="0.5"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            placeholder="2 or -2"
          />
        </Field>
        <Field label="Why" htmlFor={`adj-why-${employeeId}`} required>
          <Input
            id={`adj-why-${employeeId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Agreed with the HR Head on 8 Sept."
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await adjustLeaveBalance(
                employeeId,
                typeId,
                year,
                Number(days),
                reason,
              );
              if ("error" in result) setError(result.error);
              else {
                setError("");
                setOpen(false);
                setDays("");
                setReason("");
                router.refresh();
              }
            })
          }
        >
          {pending ? "Recording…" : "Record the adjustment"}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
