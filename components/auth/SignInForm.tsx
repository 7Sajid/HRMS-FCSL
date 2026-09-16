"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/app/actions/auth";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { ErrorBox } from "@/components/ui/Feedback";

export function SignInForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(signIn, null);

  useEffect(() => {
    if (state && "ok" in state && state.redirectTo) router.replace(state.redirectTo);
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          placeholder="you@fcslbd.com"
        />
      </Field>

      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>

      {state && "error" in state && <ErrorBox>{state.error}</ErrorBox>}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="pt-2 text-center text-xs text-ink-500">
        {/* There is no self-service reset on purpose. §4: HR hands the
            password over in person, by phone or in the joining meeting.
            A reset link in an inbox is a way into somebody's employee file. */}
        Forgotten your password? Ask HR to issue a new one.
      </p>
    </form>
  );
}
