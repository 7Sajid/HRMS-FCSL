import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/Card";

// Placeholder. Built out in its own panel.
export default async function Page() {
  await requireUser();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader title="Upload my documents" subtitle="Stage 1 — your panel opens once HR has checked these." />
      <EmptyState>Not built yet.</EmptyState>
    </main>
  );
}
