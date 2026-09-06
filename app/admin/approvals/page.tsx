import { requireCapability } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/ui/Card";

export default async function Page() {
  await requireCapability("leave.approveFinal");
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader title="Final approvals" subtitle="Super Admin panel — Panel 5." />
      <EmptyState>Not built yet.</EmptyState>
    </main>
  );
}
