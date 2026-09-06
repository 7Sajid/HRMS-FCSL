"use client";

import { useActionState } from "react";
import { requestCorrection } from "@/app/actions/me";
import { Button } from "@/components/ui/Button";
import { Field, Textarea } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function CorrectionRequestForm() {
  const [state, formAction, pending] = useActionState(requestCorrection, null);

  return (
    <form action={formAction} className="space-y-3">
      <Field label="What is wrong?" htmlFor="message">
        <Textarea
          id="message"
          name="message"
          rows={3}
          required
          minLength={5}
          placeholder="My father's name is spelled Abdul Karim, not Abdul Karin."
        />
      </Field>
      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
      {state && "ok" in state && <p className="text-sm text-success-500">Sent to HR.</p>}
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Sending…" : "Request a correction"}
      </Button>
    </form>
  );
}
