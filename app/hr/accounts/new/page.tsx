import Link from "next/link";
import { requireCapability } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { Card, PageHeader } from "@/components/ui/Card";
import { CreateAccountForm } from "@/components/hr/CreateAccountForm";

export const metadata = { title: "Create an account · FCSL HR" };

export default async function Page() {
  const context = await requireCapability("accounts.create");

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader
        title="Create an account"
        subtitle="Three pieces of information. Everything else waits until their documents arrive."
        actions={
          <Link
            href="/hr/joiners"
            className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            Back
          </Link>
        }
      />
      <Card className="p-6">
        <CreateAccountForm canCreateSenior={can(context.viewer, "accounts.manage")} />
      </Card>
    </main>
  );
}
