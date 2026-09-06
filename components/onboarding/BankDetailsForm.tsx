"use client";

import { useActionState } from "react";
import { saveBankDetails } from "@/app/actions/onboarding";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function BankDetailsForm({
  initial,
}: {
  initial: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    branchName: string;
    routingNumber: string;
  } | null;
}) {
  const [state, formAction, pending] = useActionState(saveBankDetails, null);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Name on the account" htmlFor="accountName" required>
        <Input id="accountName" name="accountName" defaultValue={initial?.accountName ?? ""} required />
      </Field>
      <Field label="Account number" htmlFor="accountNumber" required>
        <Input
          id="accountNumber"
          name="accountNumber"
          defaultValue={initial?.accountNumber ?? ""}
          inputMode="numeric"
          required
        />
      </Field>
      <Field label="Bank" htmlFor="bankName" required>
        <Input id="bankName" name="bankName" defaultValue={initial?.bankName ?? ""} required />
      </Field>
      <Field label="Branch" htmlFor="branchName" required>
        <Input id="branchName" name="branchName" defaultValue={initial?.branchName ?? ""} required />
      </Field>
      <Field label="Routing number" htmlFor="routingNumber" hint="Optional.">
        <Input
          id="routingNumber"
          name="routingNumber"
          defaultValue={initial?.routingNumber ?? ""}
          inputMode="numeric"
        />
      </Field>

      <div className="sm:col-span-2 space-y-3">
        {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}
        {state && "ok" in state && (
          <p className="text-sm text-success-500">Saved.</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : initial ? "Update bank details" : "Save bank details"}
        </Button>
      </div>
    </form>
  );
}
