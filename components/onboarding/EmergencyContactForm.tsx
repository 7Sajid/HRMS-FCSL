"use client";

import { useActionState } from "react";
import { saveEmergencyContact } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export type ContactValues = {
  name: string;
  relationship: string;
  mobile: string;
  address: string;
} | null;

export function EmergencyContactForm({
  slot,
  initial,
  pendingApproval,
}: {
  slot: 1 | 2;
  initial: ContactValues;
  pendingApproval?: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveEmergencyContact, null);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="slot" value={slot} />

      <Field label="Name" htmlFor={`name-${slot}`} required={slot === 1}>
        <Input id={`name-${slot}`} name="name" defaultValue={initial?.name ?? ""} required={slot === 1} />
      </Field>
      <Field label="Relationship" htmlFor={`rel-${slot}`} required={slot === 1}>
        <Input
          id={`rel-${slot}`}
          name="relationship"
          defaultValue={initial?.relationship ?? ""}
          placeholder="Father, spouse, sibling…"
          required={slot === 1}
        />
      </Field>
      <Field label="Mobile" htmlFor={`mob-${slot}`} required={slot === 1} hint="11 digits, like 01712345678.">
        <Input
          id={`mob-${slot}`}
          name="mobile"
          defaultValue={initial?.mobile ?? ""}
          inputMode="numeric"
          required={slot === 1}
        />
      </Field>
      {slot === 1 && (
        <Field label="Address" htmlFor={`addr-${slot}`}>
          <Input id={`addr-${slot}`} name="address" defaultValue={initial?.address ?? ""} />
        </Field>
      )}

      <div className="sm:col-span-2 space-y-3">
        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
        {state && "ok" in state && (
          <p className="text-sm text-success-500">
            {pendingApproval ? "Sent to HR to approve." : "Saved."}
          </p>
        )}
        <Button type="submit" variant={slot === 1 ? "primary" : "secondary"} disabled={pending}>
          {pending ? "Saving…" : initial ? "Update" : "Save"}
        </Button>
      </div>
    </form>
  );
}
