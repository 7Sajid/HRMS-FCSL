import { requireCapability } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/ui/Card";

export default async function Page() {
  await requireCapability("leave.approve");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader title="Leave waiting for me" subtitle="Manager panel — Panel 2." />
      <EmptyState>Not built yet.</EmptyState>
    </main>
  );
}
