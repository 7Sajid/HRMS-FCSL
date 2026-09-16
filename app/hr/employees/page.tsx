import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth";
import { visibleEmployeeWhere } from "@/lib/permissions";
import { formatDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Feedback";
import { TableShell, Tbody, Td, Th, Thead, TableEmpty } from "@/components/ui/Table";
import { EmployeeFilters } from "@/components/hr/EmployeeFilters";
import type { Prisma } from "@prisma/client";

export const metadata = { title: "Find anybody · FCSL HR" };

const PAGE_SIZE = 50;

type Props = {
  searchParams: Promise<Record<string, string | undefined>>;
};

/**
 * §5.3 page 6 — "One searchable list of every employee, Associate and manager, with
 * filters down the side."
 *
 * The export is recorded, because "a list of every employee's details leaving
 * the building is exactly the kind of event an auditor asks about."
 */
export default async function Page({ searchParams }: Props) {
  const context = await requireCapability("employees.readAll");
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const page = Math.max(1, Math.min(1000, Number(params.page) || 1));

  const where: Prisma.EmployeeWhereInput = {
    AND: [
      visibleEmployeeWhere(context.viewer, context.employeeId),
      params.branch ? { branchId: params.branch } : {},
      params.department ? { departmentId: params.department } : {},
      params.designation ? { designationId: params.designation } : {},
      params.grade ? { gradeId: params.grade } : {},
      params.manager ? { managerId: params.manager } : {},
      params.type ? { staffType: params.type as "STAFF" | "RM" } : {},
      params.status ? { status: params.status as "ACTIVE" | "LEFT" } : {},
      params.joinedFrom ? { joiningDate: { gte: new Date(`${params.joinedFrom}T00:00:00Z`) } } : {},
      params.joinedTo ? { joiningDate: { lte: new Date(`${params.joinedTo}T00:00:00Z`) } } : {},
      q
        ? {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { employeeId: { contains: q, mode: "insensitive" } },
              { user: { email: { contains: q, mode: "insensitive" } } },
              { mobile: { contains: q } },
            ],
          }
        : {},
    ],
  };

  const [rows, total, branches, departments, designations, grades, managers] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: { designation: true, branch: true, department: true, user: { select: { email: true } } },
      orderBy: [{ status: "asc" }, { idNumber: "asc" }, { fullName: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.employee.count({ where }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.designation.findMany({ orderBy: { name: "asc" } }),
    prisma.grade.findMany({ orderBy: { rank: "asc" } }),
    prisma.employee.findMany({
      where: { reports: { some: {} } },
      select: { id: true, fullName: true },
      orderBy: { fullName: "asc" },
    }),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const query = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <PageHeader
        title="Find anybody"
        subtitle={`${total} ${total === 1 ? "person" : "people"} match.`}
        actions={
          <a
            href={`/api/export?type=employees&${query.toString()}`}
            className="rounded-lg border border-ink-300/60 bg-white px-4 py-2.5 text-sm font-medium hover:bg-surface"
          >
            Export to a spreadsheet
          </a>
        }
      />

      {/* min-w-0 on both children. Without it the table's intrinsic width sets
          the size of the single column this becomes on a phone, the filter
          panel is stretched to match, and the whole page scrolls sideways. */}
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <EmployeeFilters
          options={{
            branches: branches.map((b) => ({ id: b.id, name: b.name })),
            departments: departments.map((d) => ({ id: d.id, name: d.name })),
            designations: designations.map((d) => ({ id: d.id, name: d.name })),
            grades: grades.map((g) => ({ id: g.id, name: g.name })),
            managers: managers.map((m) => ({ id: m.id, name: m.fullName })),
          }}
          current={params}
        />

        <div className="min-w-0">
          <TableShell>
            <Thead>
              <tr>
                <Th>Employee ID</Th>
                <Th>Name</Th>
                <Th>Designation</Th>
                <Th>Branch</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
              </tr>
            </Thead>
            <Tbody>
              {rows.length === 0 && (
                <TableEmpty colSpan={6}>Nobody matches those filters.</TableEmpty>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td className="whitespace-nowrap tabular text-ink-500">{row.employeeId ?? "—"}</Td>
                  <Td>
                    <Link href={`/hr/employees/${row.id}`} className="text-brand-500 hover:underline">
                      {row.fullName}
                    </Link>
                    {row.staffType === "RM" && (
                      <span className="ml-2">
                        <Badge tone="brand">Associate</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>{row.designation?.name ?? "—"}</Td>
                  <Td>{row.branch?.name ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{formatDate(row.joiningDate)}</Td>
                  <Td>
                    {row.status === "ACTIVE" ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge tone="neutral">Left</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </Tbody>
          </TableShell>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-ink-500">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                {page > 1 && <PageLink params={params} page={page - 1} label="Previous" />}
                {page < pages && <PageLink params={params} page={page + 1} label="Next" />}
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function PageLink({
  params,
  page,
  label,
}: {
  params: Record<string, string | undefined>;
  page: number;
  label: string;
}) {
  const query = new URLSearchParams(
    Object.entries({ ...params, page: String(page) }).filter(([, v]) => v) as [string, string][],
  );
  return (
    <Link
      href={`/hr/employees?${query.toString()}`}
      className="rounded-lg border border-ink-300/60 bg-white px-3 py-1.5 text-sm hover:bg-surface"
    >
      {label}
    </Link>
  );
}
