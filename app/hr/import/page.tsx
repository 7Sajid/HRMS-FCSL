import { requireCapability } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui/Card";
import { NoticeBox } from "@/components/ui/Feedback";
import { ImportPanel } from "@/components/hr/ImportPanel";

export const metadata = { title: "Import staff · FCSL HR" };

/**
 * Server Actions inherit the limit of the route they are called from, and the
 * default is ten seconds. 412 people do not go in in ten seconds however tight
 * the code is, so this raises it to the most the plan allows. `commitImport`
 * is built to finish in a small fraction of that — see the comments there —
 * and this is the headroom, not the plan.
 */
export const maxDuration = 60;

export default async function Page() {
  await requireCapability("employees.setup");

  const [existing, sequence] = await Promise.all([
    prisma.employee.count({ where: { onboardingStatus: "APPROVED" } }),
    prisma.employeeIdSequence.findUnique({ where: { id: 1 } }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        title="Import existing staff"
        subtitle="The people who already work here, with the employee IDs they already have."
      />

      <div className="mb-6">
        <NoticeBox tone="brand">
          <p>
            Existing staff are created <strong className="font-medium">directly at Stage 2</strong>.
            They do not go through the locked door — they are already employed and their files
            already exist. HR attaches their documents over time.
          </p>
          <p className="mt-1">
            {existing} {existing === 1 ? "person is" : "people are"} in the system now, and the next
            new joiner would be {sequence?.letter}{" "}
            {String(sequence?.nextNumber ?? 0).padStart(3, "0")}. After an import the counter moves
            past everybody imported, so nobody can collide.
          </p>
        </NoticeBox>
      </div>

      <Card className="p-6">
        <ImportPanel />
      </Card>
    </main>
  );
}
