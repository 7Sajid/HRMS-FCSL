import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/auth";
import { formatDate } from "@/lib/dates";
import { Card, PageHeader } from "@/components/ui/Card";
import { DataList, DataRow } from "@/components/ui/DataList";
import { Badge } from "@/components/ui/Feedback";
import { CorrectionRequestForm } from "@/components/me/CorrectionRequestForm";

export const metadata = { title: "My information · FCSL HR" };

/**
 * Page 1 (§5.1). "The employee looks at it; HR edits it."
 *
 * Read-only on purpose, with a Request a correction button that sends a note
 * rather than changing anything — so a person's own record cannot be edited by
 * the person it describes, which is the point of a staff file.
 */
export default async function Page() {
  const { employee } = await requireEmployee();

  const [detail, openRequests] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employee.id },
      include: { branch: true, department: true, designation: true, grade: true, manager: true },
    }),
    prisma.correctionRequest.findMany({
      where: { employeeId: employee.id, status: "OPEN" },
      orderBy: { raisedAt: "desc" },
    }),
  ]);
  if (!detail) return null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <PageHeader
        eyebrow={detail.employeeId ?? "NO ID YET"}
        title="My personal information"
        subtitle="This is what the company holds about you. HR keeps it up to date."
        actions={
          detail.status === "LEFT" ? <Badge tone="neutral">Left</Badge> : <Badge tone="success">Active</Badge>
        }
      />

      <Card className="p-6">
        <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">IDENTITY</h2>
        <DataList>
          <DataRow label="Employee ID" value={detail.employeeId} />
          <DataRow label="Full name" value={detail.fullName} />
          <DataRow label="Father's name" value={detail.fatherName} />
          <DataRow label="Mother's name" value={detail.motherName} />
          <DataRow label="Date of birth" value={detail.dateOfBirth ? formatDate(detail.dateOfBirth) : ""} />
          <DataRow label="Gender" value={detail.gender} />
          <DataRow label="Nationality" value={detail.nationality} />
          <DataRow label="Religion" value={detail.religion} />
          <DataRow label="Marital status" value={detail.maritalStatus} />
          <DataRow label="Mobile" value={detail.mobile} />
        </DataList>
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">EMPLOYMENT</h2>
        <DataList>
          <DataRow
            label="Role"
            value={detail.staffType === "RM" ? "Relationship Manager" : "Employee"}
          />
          <DataRow label="Designation" value={detail.designation?.name} />
          <DataRow label="Grade" value={detail.grade?.name} />
          <DataRow label="Department" value={detail.department?.name} />
          <DataRow label="Branch" value={detail.branch?.name} />
          <DataRow label="Reports to" value={detail.manager?.fullName} />
          <DataRow label="Joined" value={detail.joiningDate ? formatDate(detail.joiningDate) : ""} />
          <DataRow
            label="Confirmed"
            value={detail.confirmationDate ? formatDate(detail.confirmationDate) : ""}
          />
        </DataList>
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="text-xs font-semibold tracking-widest text-ink-400">
          SOMETHING WRONG HERE?
        </h2>
        <p className="mt-2 text-sm text-ink-500">
          Tell HR what needs changing. They make the correction — nothing on this page is edited
          directly.
        </p>
        {openRequests.length > 0 && (
          <ul className="mt-4 space-y-2">
            {openRequests.map((r) => (
              <li key={r.id} className="rounded-lg bg-warn-50 px-3 py-2 text-sm text-ink-700">
                <span className="font-medium">With HR:</span> {r.message}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <CorrectionRequestForm />
        </div>
      </Card>
    </main>
  );
}
