"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { setPassword } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function SetPasswordForm({ hint }: { hint: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(setPassword, null);

  useEffect(() => {
    if (state && "ok" in state && state.redirectTo) router.replace(state.redirectTo);
  }, [state, router]);

  const error = state && "error" in state ? state : null;

  return (
    <form action={formAction} className="space-y-4">
      <Field
        label="New password"
        htmlFor="password"
        hint={hint}
        error={error?.field === "password" ? error.error : undefined}
        required
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          autoFocus
          required
          minLength={8}
        />
      </Field>

      <Field
        label="Type it again"
        htmlFor="confirm"
        error={error?.field === "confirm" ? error.error : undefined}
        required
      >
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>

      {error && !error.field && <ErrorBox>{error.error}</ErrorBox>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Set my password"}
      </Button>
    </form>
  );
}
