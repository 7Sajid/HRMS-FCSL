import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { homePathFor } from "@/lib/permissions";
import { passwordHint } from "@/lib/passwords";
import { SetPasswordForm } from "@/components/auth/SetPasswordForm";

export const metadata = { title: "Choose a password · FCSL HR" };

export default async function SetPasswordPage() {
  const context = await getSessionContext();
  if (!context) redirect("/signin");
  // Reachable deliberately by somebody who simply wants to change their
  // password, so it is not gated on mustChangePassword — but if they have
  // already changed it and land here by accident, nothing is broken.
  const forced = context.user.mustChangePassword;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold tracking-widest text-ink-400">
            FIRST CAPITAL SECURITIES LIMITED
          </p>
          <h1 className="mt-2 text-2xl font-bold text-ink-900">
            {forced ? "Choose your password" : "Change your password"}
          </h1>
          {forced && (
            <p className="mt-2 text-sm text-ink-500">
              The password HR gave you works once. Pick one only you know.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-ink-300/40 bg-white p-6 shadow-sm">
          <SetPasswordForm hint={passwordHint(context.user.role)} />
        </div>

        {!forced && (
          <p className="mt-6 text-center text-xs text-ink-400">
            <a className="hover:text-ink-700" href={homePathFor(context.viewer)}>
              Back to my panel
            </a>
          </p>
        )}
      </div>
    </main>
  );
}
