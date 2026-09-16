import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { BranchForm, CloseBranchButton } from "@/components/registers/BranchForms";

export const metadata = { title: "Branches · FCSL HR" };

/** §6.7 — create a branch, record its details, see who is attached to it. */
export default async function Page() {
  await requireCapability("branches.manage");

  const [branches, managers] = await Promise.all([
    prisma.branch.findMany({
      include: {
        branchManager: true,
        employees: { where: { status: "ACTIVE" }, select: { id: true, staffType: true } },
      },
      orderBy: [{ closedOn: "asc" }, { name: "asc" }],
    }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED" },
      select: { id: true, fullName: true, employeeId: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const managerOptions = managers.map((m) => ({
    id: m.id,
    name: `${m.fullName}${m.employeeId ? ` · ${m.employeeId}` : ""}`,
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader title="Branches" subtitle="Where people work, and who runs each one." />

      <section className="mb-10 space-y-4">
        {branches.map((branch) => {
          const rms = branch.employees.filter((e) => e.staffType === "RM").length;
          return (
            <Card key={branch.id} className="p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink-900">{branch.name}</h2>
                    <Badge tone="neutral">{branch.code}</Badge>
                    {branch.closedOn && <Badge tone="neutral">Closed {formatDate(branch.closedOn)}</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {branch.employees.length} {branch.employees.length === 1 ? "person" : "people"}
                    {rms ? `, ${rms} Associate${rms === 1 ? "" : "s"}` : ""} ·{" "}
                    {branch.branchManager
                      ? `run by ${branch.branchManager.fullName}`
                      : "no branch manager set"}
                  </p>
                </div>
                {!branch.closedOn && (
                  <CloseBranchButton branchId={branch.id} attached={branch.employees.length} />
                )}
              </div>

              {!branch.closedOn && (
                <BranchForm
                  branchId={branch.id}
                  initial={{
                    name: branch.name,
                    code: branch.code,
                    address: branch.address,
                    phone: branch.phone,
                    openedOn: branch.openedOn ? branch.openedOn.toISOString().slice(0, 10) : "",
                    branchManagerId: branch.branchManagerId,
                  }}
                  managers={managerOptions}
                />
              )}
            </Card>
          );
        })}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Add a branch</h2>
        <Card className="p-6">
          <BranchForm branchId={null} managers={managerOptions} />
        </Card>
      </section>
    </main>
  );
}
