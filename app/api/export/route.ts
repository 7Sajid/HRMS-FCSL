import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, recordQuietly } from "@/lib/audit";
import { can, canReadBankDetailsOf, visibleEmployeeWhere } from "@/lib/permissions";
import { csvResponse, exportFileName, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime } from "@/lib/dates";
import { certificateStatus } from "@/lib/certificate";
import { actionLabel } from "@/lib/audit";
import { auditWhere, readFilters } from "@/lib/audit-query";
import { ROLE_LABELS } from "@/lib/permissions";

/** Rule 7: every list is capped, exports included. Well above FCSL's 412. */
const EXPORT_CAP = 5000;

/**
 * Exports.
 *
 * §5.3: "every export is recorded, because a list of every employee's details
 * leaving the building is exactly the kind of event an auditor asks about."
 *
 * The recording carries the filters that were applied and how many rows went
 * out, so the question "what exactly left, and when" has an answer rather than
 * an estimate.
 */
export async function GET(request: Request): Promise<Response> {
  const context = await getSessionContext();
  if (!context) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "employees";

  if (type === "employees") return exportEmployees(context, url);
  if (type === "certificates") return exportCertificates(context, url);
  if (type === "audit") return exportAudit(context, url);
  return new Response("Not found", { status: 404 });
}

type Context = NonNullable<Awaited<ReturnType<typeof getSessionContext>>>;

async function exportEmployees(context: Context, url: URL): Promise<Response> {
  if (!can(context.viewer, "employees.readAll")) return new Response("Not found", { status: 404 });

  const p = (key: string) => url.searchParams.get(key) ?? "";
  const where: Prisma.EmployeeWhereInput = {
    AND: [
      visibleEmployeeWhere(context.viewer, context.employeeId),
      p("branch") ? { branchId: p("branch") } : {},
      p("department") ? { departmentId: p("department") } : {},
      p("designation") ? { designationId: p("designation") } : {},
      p("grade") ? { gradeId: p("grade") } : {},
      p("manager") ? { managerId: p("manager") } : {},
      p("type") ? { staffType: p("type") as "STAFF" | "RM" } : {},
      p("status") ? { status: p("status") as "ACTIVE" | "LEFT" } : {},
      p("q")
        ? {
            OR: [
              { fullName: { contains: p("q"), mode: "insensitive" } },
              { employeeId: { contains: p("q"), mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const rows = await prisma.employee.findMany({
    where,
    include: {
      user: { select: { email: true, role: true } },
      branch: true,
      department: true,
      designation: true,
      grade: true,
      manager: { select: { fullName: true } },
      // Bank details are fetched only if this viewer may read them at all.
      // The Super Admin may not (§9), so their export simply has no such
      // columns rather than empty ones that invite a second attempt.
      bankDetail: canReadBankDetailsOf(context.viewer, "", null),
    },
    orderBy: [{ idNumber: "asc" }, { fullName: "asc" }],
    take: EXPORT_CAP,
  });

  const withBank = canReadBankDetailsOf(context.viewer, "", null);

  const headers = [
    "Employee ID",
    "Full name",
    "Email",
    "Mobile",
    "Staff or RM",
    "Designation",
    "Grade",
    "Department",
    "Branch",
    "Reports to",
    "Joined",
    "Confirmed",
    "Status",
    "Last working day",
    ...(withBank ? ["Bank", "Bank branch", "Account name", "Account number", "Routing"] : []),
  ];

  const body = rows.map((row) => [
    row.employeeId ?? "",
    row.fullName,
    row.user.email,
    row.mobile,
    row.staffType === "RM" ? "RM" : "Staff",
    row.designation?.name ?? "",
    row.grade?.name ?? "",
    row.department?.name ?? "",
    row.branch?.name ?? "",
    row.manager?.fullName ?? "",
    row.joiningDate ? formatDate(row.joiningDate) : "",
    row.confirmationDate ? formatDate(row.confirmationDate) : "",
    row.status === "ACTIVE" ? "Active" : "Left",
    row.lastWorkingDay ? formatDate(row.lastWorkingDay) : "",
    ...(withBank
      ? [
          row.bankDetail?.bankName ?? "",
          row.bankDetail?.branchName ?? "",
          row.bankDetail?.accountName ?? "",
          row.bankDetail?.accountNumber ?? "",
          row.bankDetail?.routingNumber ?? "",
        ]
      : []),
  ]);

  await recordQuietly({
    action: "export.employees",
    actor: actorFrom({
      ...context.user,
      fullName: context.employee?.fullName ?? context.user.email,
    }),
    targetType: "export",
    targetLabel: `${rows.length} employees`,
    detail: {
      rows: rows.length,
      includedBankDetails: withBank,
      filters: Object.fromEntries(url.searchParams.entries()),
    },
    ip: await currentIp(),
  });

  return csvResponse(toCsv(headers, body), exportFileName("employees"));
}

async function exportCertificates(context: Context, url: URL): Promise<Response> {
  if (!can(context.viewer, "certificates.manage")) return new Response("Not found", { status: 404 });

  const rows = await prisma.rmCertificate.findMany({
    where: { status: "ACTIVE" },
    include: { employee: { include: { branch: true } } },
    orderBy: { expiryDate: "asc" },
    // The same cap the employee export has carried all along. An export is a
    // file somebody downloads; it must not be the one request that can ask the
    // database for everything at once.
    take: EXPORT_CAP,
  });

  const headers = [
    "Employee ID",
    "Name",
    "Branch",
    "Certificate number",
    "Issued",
    "Expires",
    "Status",
    "Days remaining",
  ];
  const body = rows.map((row) => {
    const status = certificateStatus(row);
    return [
      row.employee.employeeId ?? "",
      row.employee.fullName,
      row.employee.branch?.name ?? "",
      row.certificateNumber,
      formatDate(row.issueDate),
      formatDate(row.expiryDate),
      status.label,
      status.daysRemaining ?? "",
    ];
  });

  await recordQuietly({
    action: "export.report",
    actor: actorFrom({
      ...context.user,
      fullName: context.employee?.fullName ?? context.user.email,
    }),
    targetType: "export",
    targetLabel: `${rows.length} RM certificates`,
    detail: { rows: rows.length, report: "certificates" },
    ip: await currentIp(),
  });

  void url;
  return csvResponse(toCsv(headers, body), exportFileName("rm-certificates"));
}

/**
 * The permanent record, out to a spreadsheet (P4.7).
 *
 * Exporting the log writes a line to the log. That is not circular reasoning —
 * it is the point: an auditor's question is "who took a copy of this, and
 * when", and the answer has to be inside the thing that cannot be edited.
 *
 * The row cap is deliberate and stated on the file rather than silently
 * truncating. Somebody who needs the whole of 2026 narrows by date and takes
 * it a month at a time; nobody needs a browser to stream four years of log
 * through a single response.
 */
const AUDIT_EXPORT_CAP = 10_000;

async function exportAudit(context: Context, url: URL): Promise<Response> {
  if (!can(context.viewer, "audit.read")) return new Response("Not found", { status: 404 });

  const filters = readFilters(url.searchParams);
  const rows = await prisma.auditEvent.findMany({
    where: auditWhere(filters),
    orderBy: { createdAt: "desc" },
    take: AUDIT_EXPORT_CAP,
  });

  const headers = [
    "When",
    "Who",
    "Their role at the time",
    "What happened",
    "Action name",
    "To what",
    "Target type",
    "Target id",
    "Detail",
    "IP",
  ];

  const body = rows.map((row) => [
    // The instant in full, in Dhaka, because a log read six hours out is a log
    // that puts an evening action on the wrong day.
    formatDateTime(row.createdAt),
    row.actorName,
    ROLE_LABELS[row.actorRole as keyof typeof ROLE_LABELS] ?? row.actorRole,
    actionLabel(row.action),
    row.action,
    row.targetLabel,
    row.targetType ?? "",
    row.targetId ?? "",
    row.detail ? JSON.stringify(row.detail) : "",
    row.ip,
  ]);

  await recordQuietly({
    action: "export.audit",
    actor: actorFrom({
      ...context.user,
      fullName: context.employee?.fullName ?? context.user.email,
    }),
    targetType: "export",
    // The label is written once and can never be corrected, so it reads
    // correctly for one row as well as for ten thousand.
    targetLabel: `${rows.length} ${rows.length === 1 ? "line" : "lines"} of the permanent record`,
    detail: {
      rows: rows.length,
      truncated: rows.length === AUDIT_EXPORT_CAP,
      filters: Object.fromEntries(url.searchParams.entries()),
    },
    ip: await currentIp(),
  });

  return csvResponse(toCsv(headers, body), exportFileName("permanent-record"));
}
