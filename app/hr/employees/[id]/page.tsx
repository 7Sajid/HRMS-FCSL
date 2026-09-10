import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { can, canReadBankDetailsOf } from "@/lib/permissions";
import { formatDate, formatDateTime, todayInDhaka } from "@/lib/dates";
import { documentLabel } from "@/lib/documents";
import { certificateStatus } from "@/lib/certificate";
import { ensureEntitlements, leaveTypesFor } from "@/lib/leave-service";
import { Card, EmptyState, PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { DataList, DataRow } from "@/components/ui/DataList";
import { AssignmentForm } from "@/components/hr/AssignmentForm";
import { ContactChange, CorrectionRequestRow } from "@/components/hr/PendingApprovals";
import { ReissuePassword } from "@/components/hr/ReissuePassword";
import { AdjustLeave } from "@/components/hr/AdjustLeave";

type Props = { params: Promise<{ id: string }> };

/** One person's whole file, as HR sees it. */
export default async function Page({ params }: Props) {
  const context = await requireCapability("employees.readAll");
  const { id } = await params;
  const today = todayInDhaka();

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, role: true, disabledAt: true } },
      branch: true,
      department: true,
      designation: true,
      grade: true,
      manager: true,
      bankDetail: true,
      documents: { where: { supersededAt: null }, orderBy: { uploadedAt: "desc" } },
      emergencyContacts: { orderBy: [{ slot: "asc" }, { proposedAt: "desc" }] },
      correctionRequests: { where: { status: "OPEN" }, orderBy: { raisedAt: "desc" } },
      certificates: { orderBy: { expiryDate: "desc" } },
      assignments: {
        include: { branch: true, department: true, designation: true, grade: true, manager: true },
        orderBy: { effectiveFrom: "desc" },
      },
      terminalAssignments: { where: { releasedOn: null }, include: { terminal: true } },
      exit: true,
    },
  });
  if (!employee) notFound();

  // Granted before it is read, exactly as the person's own leave page does.
  // Without this a joiner shows "0 of 0" to whoever opens their file until
  // they happen to visit their own screen — and HR, looking at zeros, would
  // reasonably conclude they had no entitlement at all.
  await ensureEntitlements(employee, today);

  const [balances, branches, departments, designations, grades, managers] = await Promise.all([
    leaveTypesFor(employee, today),
    prisma.branch.findMany({ where: { closedOn: null }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { retiredAt: null }, orderBy: { name: "asc" } }),
    prisma.designation.findMany({ where: { retiredAt: null }, orderBy: { name: "asc" } }),
    prisma.grade.findMany({ where: { retiredAt: null }, orderBy: { rank: "asc" } }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED", id: { not: id } },
      select: { id: true, fullName: true, employeeId: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const showBank = canReadBankDetailsOf(context.viewer, employee.id, context.employeeId);
  const activeCertificate = employee.certificates.find((c) => c.status === "ACTIVE") ?? null;
  const certificate = certificateStatus(activeCertificate, today);
  const pendingContacts = employee.emergencyContacts.filter((c) => c.status === "PENDING");
  const currentContacts = employee.emergencyContacts.filter((c) => c.status === "CURRENT");

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <PageHeader
        eyebrow={`${employee.employeeId ?? "NO ID"} · ${employee.user.email}`}
        title={employee.fullName}
        subtitle={[employee.designation?.name, employee.branch?.name].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-2">
            {employee.staffType === "RM" && <Badge tone="brand">RM</Badge>}
            {employee.status === "ACTIVE" ? (
              <Badge tone="success">Active</Badge>
            ) : (
              <Badge tone="neutral">Left {formatDate(employee.lastWorkingDay)}</Badge>
            )}
            <Link
              href="/hr/employees"
              className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
            >
              Back
            </Link>
          </div>
        }
      />

      {can(context.viewer, "accounts.create") && employee.status === "ACTIVE" && (
        // "If you lose it, issue a new one from their file" — said on the
        // create-account screen and on the sign-in page, and until now there
        // was no such thing. A temporary password lasts seven days; without
        // this anybody who let theirs lapse was locked out for good.
        <section className="mb-6">
          <Card className="p-6">
            <h2 className="mb-1 text-xs font-semibold tracking-widest text-ink-400">SIGNING IN</h2>
            <p className="mb-4 text-sm text-ink-500">
              {employee.user.disabledAt
                ? "This account is closed. Re-open it before issuing a password."
                : "For somebody who has lost their password, or whose temporary one has expired."}
            </p>
            {!employee.user.disabledAt && (
              <ReissuePassword employeeId={employee.id} fullName={employee.fullName} />
            )}
          </Card>
        </section>
      )}

      {(pendingContacts.length > 0 || employee.correctionRequests.length > 0) && (
        <section className="mb-6 space-y-3">
          <h2 className="text-sm font-semibold text-ink-900">Waiting for you</h2>
          {pendingContacts.map((contact) => (
            <ContactChange
              key={contact.id}
              id={contact.id}
              proposed={`${contact.name} (${contact.relationship}) · ${contact.mobile}`}
              currentValue={(() => {
                const live = currentContacts.find((c) => c.slot === contact.slot);
                return live ? `${live.name} (${live.relationship}) · ${live.mobile}` : "";
              })()}
            />
          ))}
          {employee.correctionRequests.map((request) => (
            <CorrectionRequestRow key={request.id} id={request.id} message={request.message} />
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">IDENTITY</h2>
          <DataList>
            <DataRow label="Employee ID" value={employee.employeeId} />
            <DataRow label="Full name" value={employee.fullName} />
            <DataRow label="Father's name" value={employee.fatherName} />
            <DataRow label="Mother's name" value={employee.motherName} />
            <DataRow label="Date of birth" value={employee.dateOfBirth ? formatDate(employee.dateOfBirth) : ""} />
            <DataRow label="NID" value={employee.nidNumber} />
            <DataRow label="Gender" value={employee.gender} />
            <DataRow label="Nationality" value={employee.nationality} />
            <DataRow label="Religion" value={employee.religion} />
            <DataRow label="Marital status" value={employee.maritalStatus} />
            <DataRow label="Mobile" value={employee.mobile} />
            <DataRow label="Personal email" value={employee.personalEmail} />
            <DataRow label="Present address" value={employee.presentAddress} wide />
            <DataRow label="Permanent address" value={employee.permanentAddress} wide />
          </DataList>
        </Card>

        <div className="space-y-4">
          <Card className="p-6">
            <h2 className="mb-5 text-xs font-semibold tracking-widest text-ink-400">EMPLOYMENT</h2>
            <DataList>
              <DataRow label="Designation" value={employee.designation?.name} />
              <DataRow label="Grade" value={employee.grade?.name} />
              <DataRow label="Department" value={employee.department?.name} />
              <DataRow label="Branch" value={employee.branch?.name} />
              <DataRow label="Reports to" value={employee.manager?.fullName} />
              <DataRow label="Joined" value={employee.joiningDate ? formatDate(employee.joiningDate) : ""} />
              <DataRow
                label="Confirmed"
                value={employee.confirmationDate ? formatDate(employee.confirmationDate) : ""}
              />
              <DataRow label="Account" value={employee.user.disabledAt ? "Disabled" : "Active"} />
            </DataList>
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">BANK DETAILS</h2>
            {showBank ? (
              employee.bankDetail ? (
                <DataList>
                  <DataRow label="Account name" value={employee.bankDetail.accountName} />
                  <DataRow label="Account number" value={employee.bankDetail.accountNumber} />
                  <DataRow label="Bank" value={employee.bankDetail.bankName} />
                  <DataRow label="Branch" value={employee.bankDetail.branchName} />
                  <DataRow label="Routing" value={employee.bankDetail.routingNumber} />
                </DataList>
              ) : (
                <p className="text-sm text-ink-400">Not filled in.</p>
              )
            ) : (
              // §9: the Super Admin cannot see bank details. Said plainly
              // rather than shown as empty fields inviting a second attempt.
              <p className="text-sm text-ink-400">
                Bank details are held by HR. Your role does not include them.
              </p>
            )}
          </Card>

          {employee.staffType === "RM" && (
            <Card className="p-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-widest text-ink-400">RM CERTIFICATE</h2>
                <Badge tone={certificate.tone}>{certificate.label}</Badge>
              </div>
              <p className="text-sm text-ink-700">{certificate.sentence}</p>
              {activeCertificate && (
                <p className="mt-2 text-xs text-ink-500">
                  {activeCertificate.certificateNumber} · issued{" "}
                  {formatDate(activeCertificate.issueDate)}
                </p>
              )}
            </Card>
          )}

          {employee.terminalAssignments.length > 0 && (
            <Card className="p-6">
              <h2 className="mb-3 text-xs font-semibold tracking-widest text-ink-400">
                TRADING TERMINALS
              </h2>
              <ul className="space-y-1 text-sm">
                {employee.terminalAssignments.map((assignment) => (
                  <li key={assignment.id}>
                    {assignment.terminal.terminalId} · {assignment.terminal.exchange} · since{" "}
                    {formatDate(assignment.assignedOn)}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Leave this year</h2>
        <Card className="p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {balances.map((type) => (
              <div key={type.id}>
                <p className="text-xs uppercase tracking-wide text-ink-400">{type.name}</p>
                <p className="text-xl font-bold tabular text-ink-900">
                  {type.uncounted ? "—" : type.balance.applicable}
                </p>
                <p className="text-xs text-ink-500">
                  {type.uncounted ? "not counted" : `of ${type.balance.entitled}`}
                </p>
              </div>
            ))}
          </div>

          {can(context.viewer, "employees.setup") && balances.length > 0 && (
            <div className="mt-5 border-t border-ink-300/40 pt-5">
              <AdjustLeave
                employeeId={employee.id}
                periodLabel={`${formatDate(balances[0]!.period.from)} – ${formatDate(balances[0]!.period.to)}`}
                types={balances
                  .filter((t) => !t.uncounted)
                  .map((t) => ({ id: t.id, name: t.name }))}
              />
            </div>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-ink-900">Documents</h2>
        {employee.documents.length === 0 ? (
          <EmptyState>Nothing on file.</EmptyState>
        ) : (
          <Card className="divide-y divide-ink-300/20">
            {employee.documents.map((doc) => (
              <div key={doc.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-900">{documentLabel(doc.kind)}</p>
                  <p className="truncate text-xs text-ink-500">
                    {doc.originalName} · {formatDate(doc.uploadedAt)}
                  </p>
                </div>
                {doc.status === "ACCEPTED" && <Badge tone="success">Accepted</Badge>}
                {doc.status === "PENDING" && <Badge tone="warn">Unchecked</Badge>}
                {doc.status === "REJECTED" && <Badge tone="danger">Sent back</Badge>}
                {doc.purgedAt ? (
                  <span className="text-xs text-ink-400">Removed under retention</span>
                ) : (
                  <a
                    href={`/api/download?id=${doc.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-ink-300/60 bg-white px-3 py-1.5 text-xs font-medium hover:bg-surface"
                  >
                    Open
                  </a>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold text-ink-900">Posting history</h2>
        <p className="mb-3 text-xs text-ink-500">Never overwritten. Every change is a dated row.</p>
        <Card className="divide-y divide-ink-300/20">
          {employee.assignments.map((assignment) => (
            <div key={assignment.id} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={assignment.effectiveTo ? "neutral" : "success"}>
                  {assignment.reason.replace(/_/g, " ").toLowerCase()}
                </Badge>
                <span className="text-ink-500">
                  {formatDate(assignment.effectiveFrom)}
                  {assignment.effectiveTo ? ` – ${formatDate(assignment.effectiveTo)}` : " – now"}
                </span>
              </div>
              <p className="mt-1 text-ink-700">
                {[
                  assignment.designation?.name,
                  assignment.grade?.name,
                  assignment.department?.name,
                  assignment.branch?.name,
                  assignment.manager ? `reports to ${assignment.manager.fullName}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
              <p className="mt-0.5 text-xs text-ink-400">
                Recorded by {assignment.recordedByName} on {formatDateTime(assignment.createdAt)}
                {assignment.note ? ` — ${assignment.note}` : ""}
              </p>
            </div>
          ))}
        </Card>
      </section>

      {can(context.viewer, "employees.setup") && employee.status === "ACTIVE" && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-ink-900">Record a change</h2>
          <Card className="p-6">
            <AssignmentForm
              employeeId={employee.id}
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
              current={{
                branchId: employee.branchId,
                departmentId: employee.departmentId,
                designationId: employee.designationId,
                gradeId: employee.gradeId,
                managerId: employee.managerId,
              }}
            />
          </Card>
        </section>
      )}
    </main>
  );
}
