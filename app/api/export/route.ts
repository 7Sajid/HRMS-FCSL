import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, recordQuietly } from "@/lib/audit";
import { can, canReadBankDetailsOf, visibleEmployeeWhere } from "@/lib/permissions";
import { csvResponse, exportFileName, toCsv } from "@/lib/csv";
import { formatDate } from "@/lib/dates";
import { certificateStatus } from "@/lib/certificate";

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
    take: 5000,
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
