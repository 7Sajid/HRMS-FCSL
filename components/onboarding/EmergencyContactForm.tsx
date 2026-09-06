"use client";

import { useActionState, useEffect, useState } from "react";
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

const EMPTY = { name: "", relationship: "", mobile: "", address: "" };

/**
 * Controlled, not uncontrolled — deliberately.
 *
 * React 19 resets an uncontrolled form after a form action completes. With
 * defaultValue the fields emptied the moment the change was saved, so the
 * screen said "sent to HR" above four blank boxes and the person could not see
 * what they had just submitted.
 */
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
  const [values, setValues] = useState(initial ?? EMPTY);

  // Re-sync when the server sends new data — after a save, or when HR approves
  // a proposal elsewhere. Keyed on the values themselves rather than on a
  // render count, so typing is never interrupted mid-edit.
  const serverValues = initial ?? EMPTY;
  useEffect(() => {
    setValues(serverValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverValues.name, serverValues.relationship, serverValues.mobile, serverValues.address]);

  const set = (field: keyof typeof EMPTY) => (event: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [field]: event.target.value }));

  const required = slot === 1;

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="slot" value={slot} />

      <Field label="Name" htmlFor={`name-${slot}`} required={required}>
        <Input
          id={`name-${slot}`}
          name="name"
          value={values.name}
          onChange={set("name")}
          required={required}
        />
      </Field>
      <Field label="Relationship" htmlFor={`rel-${slot}`} required={required}>
        <Input
          id={`rel-${slot}`}
          name="relationship"
          value={values.relationship}
          onChange={set("relationship")}
          placeholder="Father, spouse, sibling…"
          required={required}
        />
      </Field>
      <Field
        label="Mobile"
        htmlFor={`mob-${slot}`}
        required={required}
        hint="11 digits, like 01712345678."
      >
        <Input
          id={`mob-${slot}`}
          name="mobile"
          value={values.mobile}
          onChange={set("mobile")}
          inputMode="numeric"
          required={required}
        />
      </Field>
      {slot === 1 && (
        <Field label="Address" htmlFor={`addr-${slot}`}>
          <Input id={`addr-${slot}`} name="address" value={values.address} onChange={set("address")} />
        </Field>
      )}

      <div className="sm:col-span-2 space-y-3">
        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
        {state && "ok" in state && (
          <p className="text-sm text-success-500">
            {pendingApproval ? "Sent to HR to approve." : "Saved."}
          </p>
        )}
        <Button type="submit" variant={required ? "primary" : "secondary"} disabled={pending}>
          {pending ? "Saving…" : initial ? "Update" : "Save"}
        </Button>
      </div>
    </form>
  );
}
