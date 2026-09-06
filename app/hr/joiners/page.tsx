import { requireCapability } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/ui/Card";

export default async function Page() {
  await requireCapability("documents.approve");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader title="Joiners waiting for review" subtitle="HR Executive panel — Panel 3." />
      <EmptyState>Not built yet.</EmptyState>
    </main>
  );
}
