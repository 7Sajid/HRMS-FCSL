import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { homePathFor } from "@/lib/permissions";
import { SignInForm } from "@/components/auth/SignInForm";

export const metadata = { title: "Sign in · FCSL HR" };

export default async function SignInPage() {
  const context = await getSessionContext();
  if (context) redirect(homePathFor(context.viewer));

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[11px] font-semibold tracking-widest text-ink-400">
            FIRST CAPITAL SECURITIES LIMITED
          </p>
          <h1 className="mt-2 text-2xl font-bold text-ink-900">HR Management System</h1>
        </div>

        <div className="rounded-2xl border border-ink-300/40 bg-white p-6 shadow-sm">
          <SignInForm />
        </div>

        <p className="mt-6 text-center text-xs text-ink-400">
          This system holds staff records. Every sign-in is recorded.
        </p>
      </div>
    </main>
  );
}
