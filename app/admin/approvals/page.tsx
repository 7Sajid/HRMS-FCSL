import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Card";

// Placeholder. Built out in its own panel.
export default async function Page() {
  await requireUser();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader title="Final approvals" subtitle="Super Admin panel — Panel 5." />
      <EmptyState>Not built yet.</EmptyState>
    </main>
  );
}
