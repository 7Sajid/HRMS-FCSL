import { requireEmployee } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/ui/Card";

export default async function Page() {
  const { employee } = await requireEmployee();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        eyebrow={employee.employeeId ?? undefined}
        title="My personal information"
        subtitle="Employee panel — Panel 1."
      />
      <EmptyState>Not built yet.</EmptyState>
    </main>
  );
}
