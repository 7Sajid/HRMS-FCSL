import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { documentLabel } from "@/lib/documents";
import { loadOnboardingState } from "@/lib/onboarding";
import { formatEmployeeId } from "@/lib/employee-id";
import { toISODate } from "@/lib/dates";
import { PageHeader } from "@/components/ui/Card";
import { Badge, NoticeBox } from "@/components/ui/Feedback";
import { ReviewPanel, type ReviewDoc } from "@/components/hr/ReviewPanel";

type Props = { params: Promise<{ id: string }> };

export default async function Page({ params }: Props) {
  const context = await requireCapability("documents.approve");
  const { id } = await params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, role: true } },
      documents: { where: { supersededAt: null }, orderBy: { uploadedAt: "asc" } },
      bankDetail: true,
      emergencyContacts: { where: { status: { in: ["CURRENT", "PENDING"] } }, orderBy: { slot: "asc" } },
    },
  });
  if (!employee) notFound();

  const [state, sequence, branches, departments, designations, grades, managers] = await Promise.all([
    loadOnboardingState(employee),
    prisma.employeeIdSequence.findUnique({ where: { id: 1 } }),
    prisma.branch.findMany({ where: { closedOn: null }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { retiredAt: null }, orderBy: { name: "asc" } }),
    prisma.designation.findMany({ where: { retiredAt: null }, orderBy: { name: "asc" } }),
    prisma.grade.findMany({ where: { retiredAt: null }, orderBy: { rank: "asc" } }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED", id: { not: employee.id } },
      orderBy: { fullName: "asc" },
      take: 500,
    }),
  ]);

  const suggested = sequence
    ? formatEmployeeId({
        letter: sequence.letter,
        number: sequence.nextNumber,
        year: new Date().getUTCFullYear(),
      })
    : "—";

  const documents: ReviewDoc[] = employee.documents.map((doc) => ({
    id: doc.id,
    kind: doc.kind,
    label: documentLabel(doc.kind),
    fileName: doc.originalName,
    status: doc.status,
    rejectionReason: doc.rejectionReason,
    isImage: doc.mimeType.startsWith("image/"),
    issueDate: doc.issueDate ? toISODate(doc.issueDate) : null,
    expiryDate: doc.expiryDate ? toISODate(doc.expiryDate) : null,
  }));

  // §3: the HR Head's own documents go to the Super Admin.
  const canApprove =
    employee.user.role === "HR_HEAD" || employee.user.role === "SUPER_ADMIN"
      ? can(context.viewer, "accounts.manage")
      : true;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        eyebrow={`${employee.user.email} · ${employee.staffType === "RM" ? "RM" : "STAFF"}`}
        title={employee.fullName}
        subtitle={state.progress.label}
        actions={
          <div className="flex items-center gap-2">
            {employee.onboardingStatus === "SUBMITTED" && <Badge tone="warn">Waiting for you</Badge>}
            {employee.onboardingStatus === "SENT_BACK" && <Badge tone="danger">Sent back</Badge>}
            {employee.onboardingStatus === "DRAFT" && <Badge tone="neutral">Not submitted</Badge>}
            {employee.onboardingStatus === "APPROVED" && <Badge tone="success">Approved</Badge>}
            <Link
              href="/hr/joiners"
              className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
            >
              Back
            </Link>
          </div>
        }
      />

      {employee.onboardingStatus === "APPROVED" && (
        <div className="mb-6">
          <NoticeBox tone="success">
            Approved. Employee ID {employee.employeeId}. Their panel is open.
          </NoticeBox>
        </div>
      )}

      {employee.onboardingStatus === "DRAFT" && (
        <div className="mb-6">
          <NoticeBox tone="warn">
            They have not submitted yet, so this file is still theirs to change. You can look, but
            approving now would lock in whatever is here.
          </NoticeBox>
        </div>
      )}

      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-ink-300/40 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">BANK DETAILS</h2>
          {employee.bankDetail ? (
            <dl className="space-y-1 text-sm">
              <Line label="Account name" value={employee.bankDetail.accountName} />
              <Line label="Account number" value={employee.bankDetail.accountNumber} />
              <Line label="Bank" value={employee.bankDetail.bankName} />
              <Line label="Branch" value={employee.bankDetail.branchName} />
              <Line label="Routing" value={employee.bankDetail.routingNumber} />
            </dl>
          ) : (
            <p className="text-sm text-ink-400">Not filled in yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-ink-300/40 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
            EMERGENCY CONTACTS
          </h2>
          {employee.emergencyContacts.length ? (
            <ul className="space-y-2 text-sm">
              {employee.emergencyContacts.map((contact) => (
                <li key={contact.id}>
                  <span className="text-ink-900">{contact.name}</span>{" "}
                  <span className="text-ink-500">
                    ({contact.relationship}) · {contact.mobile}
                  </span>
                  {contact.status === "PENDING" && (
                    <span className="ml-2">
                      <Badge tone="warn">Change waiting</Badge>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-400">Not filled in yet.</p>
          )}
        </div>
      </section>

      <ReviewPanel
        employeeId={employee.id}
        documents={documents}
        details={{
          fullName: employee.fullName,
          fatherName: employee.fatherName,
          motherName: employee.motherName,
          dateOfBirth: employee.dateOfBirth ? toISODate(employee.dateOfBirth) : "",
          gender: employee.gender,
          nationality: employee.nationality,
          religion: employee.religion,
          maritalStatus: employee.maritalStatus,
          nidNumber: employee.nidNumber,
          mobile: employee.mobile,
          personalEmail: employee.personalEmail,
          presentAddress: employee.presentAddress,
          permanentAddress: employee.permanentAddress,
        }}
        options={{
          branches: branches.map((b) => ({ id: b.id, name: b.name })),
          departments: departments.map((d) => ({ id: d.id, name: d.name })),
          designations: designations.map((d) => ({ id: d.id, name: d.name })),
          grades: grades.map((g) => ({ id: g.id, name: g.name })),
          managers: managers.map((m) => ({
            id: m.id,
            name: `${m.fullName}${m.employeeId ? ` · ${m.employeeId}` : ""}`,
          })),
        }}
        suggestedId={suggested}
        canApprove={canApprove}
      />
    </main>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-xs uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-ink-900">{value || "—"}</dd>
    </div>
  );
}
