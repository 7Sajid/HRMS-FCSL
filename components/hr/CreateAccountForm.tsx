"use client";

import { useActionState } from "react";
import { createAccount } from "@/app/actions/hr-accounts";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { ErrorBox, NoticeBox } from "@/components/ui/Feedback";

/**
 * §4 step 1 — three fields, plus what kind of user this will be, because that
 * decides which documents will be demanded.
 */
export function CreateAccountForm({ canCreateSenior }: { canCreateSenior: boolean }) {
  const [state, formAction, pending] = useActionState(createAccount, null);
  const error = state && "error" in state ? state : null;

  if (state && "ok" in state) {
    return (
      <div className="space-y-4">
        <NoticeBox tone="success">
          <p className="font-medium">{state.name}&rsquo;s account is created.</p>
          <p className="mt-1">They are at Stage 1 — their panel opens when you approve their documents.</p>
        </NoticeBox>

        <div className="rounded-xl border-2 border-brand-500 bg-brand-50/40 p-6">
          <p className="text-xs font-semibold tracking-widest text-ink-400">TEMPORARY PASSWORD</p>
          <p className="mt-2 select-all font-mono text-2xl font-bold tracking-wide text-ink-900">
            {state.dictation}
          </p>
          <p className="mt-3 text-sm text-ink-700">
            {/* §4 step 2: handed over by a person, never emailed. Sending a
                first password by email means anyone who can read that inbox
                can become that employee. */}
            <strong className="font-medium">Hand this over by phone or in person — never by email.</strong>{" "}
            The spaces are for reading it aloud and are not part of the password. It works once and
            expires on {state.expiresAt}.
          </p>
          <p className="mt-2 text-sm text-warn-500">
            This is shown once. If you lose it, issue a new one from their file.
          </p>
        </div>

        <Button variant="secondary" onClick={() => window.location.reload()}>
          Create another
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Full name"
          htmlFor="fullName"
          required
          error={error?.field === "fullName" ? error.error : undefined}
        >
          <Input id="fullName" name="fullName" autoFocus required />
        </Field>
        <Field
          label="Email"
          htmlFor="email"
          required
          hint="This is how they sign in."
          error={error?.field === "email" ? error.error : undefined}
        >
          <Input id="email" name="email" type="email" required />
        </Field>
        <Field
          label="Mobile"
          htmlFor="mobile"
          required
          hint="11 digits, like 01712345678."
          error={error?.field === "mobile" ? error.error : undefined}
        >
          <Input id="mobile" name="mobile" inputMode="numeric" required />
        </Field>
        <Field
          label="What kind of user"
          htmlFor="role"
          required
          error={error?.field === "role" ? error.error : undefined}
        >
          <Select id="role" name="role" defaultValue="EMPLOYEE">
            <option value="EMPLOYEE">Employee</option>
            <option value="MANAGER">Manager · Department Head · Divisional Manager</option>
            <option value="HR_EXECUTIVE">HR Executive</option>
            {canCreateSenior && <option value="HR_HEAD">HR Head</option>}
            {canCreateSenior && <option value="SUPER_ADMIN">Super Admin</option>}
          </Select>
        </Field>
        <Field
          label="Staff or RM"
          htmlFor="staffType"
          required
          hint="An RM must also supply an experience letter, a release letter and their BSEC certificate."
        >
          <Select id="staffType" name="staffType" defaultValue="STAFF">
            <option value="STAFF">Staff</option>
            <option value="RM">Relationship Manager</option>
          </Select>
        </Field>
      </div>

      {error && !error.field && <ErrorBox>{error.error}</ErrorBox>}

      <NoticeBox tone="brand">
        Nothing else is needed yet. Their employee ID, branch, department and manager are all set at
        the moment you approve their documents — when the evidence is in front of you.
      </NoticeBox>

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create the account"}
      </Button>
    </form>
  );
}
