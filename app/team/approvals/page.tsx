import { requireCapability } from "@/lib/auth";
import { PageHeader } from "@/components/ui/Card";
import { LeaveInbox } from "@/components/approvals/LeaveInbox";

export const metadata = { title: "Leave waiting for me · FCSL HR" };

export default async function Page() {
  const context = await requireCapability("leave.approve");

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Leave waiting for me"
        subtitle="Your team's applications. Granting passes each one to the HR Head — it does not finish it."
      />
      <LeaveInbox actorRole={context.user.role} actorEmployeeId={context.employeeId} />
    </main>
  );
}
