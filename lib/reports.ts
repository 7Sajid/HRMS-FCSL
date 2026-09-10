import { prisma } from "./db";
import { todayInDhaka } from "./dates";
import { certificateStatus, expiringWithinMonths } from "./certificate";
import { requiredKinds } from "./documents";

/**
 * §6.10 — "a dashboard answering the questions a Head of HR is actually
 * asked."
 *
 * Each figure is computed from the same rows the screens use, so a report can
 * never disagree with the page it summarises.
 */

export type Headcount = {
  active: number;
  left: number;
  employees: number;
  rms: number;
  managers: number;
  joinedThisMonth: number;
  leftThisMonth: number;
  net: number;
  byBranch: { name: string; active: number; rms: number }[];
  byDepartment: { name: string; active: number }[];
  byGrade: { name: string; active: number }[];
};

/**
 * Rule 7 — "nothing unbounded reaches a page. Every list is paged; every count
 * is capped."
 *
 * A dashboard is the awkward case, because a figure about everybody has to
 * consider everybody. The answer is not to read fewer people, it is to make
 * the database do the counting: every number below is an aggregate, and the
 * only rows that travel are the ones actually printed.
 *
 * This used to load all 412 employees with four joins each and then run about
 * fifty `.filter().length` passes over the array in JavaScript.
 */
export async function headcount(): Promise<Headcount> {
  const today = todayInDhaka();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const approved = { onboardingStatus: "APPROVED" } as const;
  const activeStaff = { ...approved, status: "ACTIVE" } as const;
  const notAManager = { user: { role: { not: "MANAGER" } } } as const;

  const [
    active,
    left,
    managers,
    rms,
    employees,
    joinedThisMonth,
    leftThisMonth,
    perBranch,
    perDepartment,
    perGrade,
    branches,
    departments,
    grades,
  ] = await Promise.all([
    prisma.employee.count({ where: { ...approved, status: "ACTIVE" } }),
    prisma.employee.count({ where: { ...approved, status: "LEFT" } }),
    // §6.6: "split into employees, RMs and managers". A manager is counted as
    // a manager rather than twice.
    prisma.employee.count({ where: { ...activeStaff, user: { role: "MANAGER" } } }),
    prisma.employee.count({ where: { ...activeStaff, staffType: "RM", ...notAManager } }),
    prisma.employee.count({ where: { ...activeStaff, staffType: "STAFF", ...notAManager } }),
    prisma.employee.count({ where: { ...activeStaff, joiningDate: { gte: monthStart } } }),
    prisma.employee.count({
      where: { ...approved, status: "LEFT", lastWorkingDay: { gte: monthStart } },
    }),
    // One pass gives both the branch total and the RM count within it.
    prisma.employee.groupBy({
      by: ["branchId", "staffType"],
      where: activeStaff,
      _count: { _all: true },
    }),
    prisma.employee.groupBy({ by: ["departmentId"], where: activeStaff, _count: { _all: true } }),
    prisma.employee.groupBy({ by: ["gradeId"], where: activeStaff, _count: { _all: true } }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.grade.findMany({ orderBy: { rank: "asc" } }),
  ]);

  const branchTotal = new Map<string, number>();
  const branchRms = new Map<string, number>();
  for (const row of perBranch) {
    if (!row.branchId) continue;
    const n = row._count._all;
    branchTotal.set(row.branchId, (branchTotal.get(row.branchId) ?? 0) + n);
    if (row.staffType === "RM") branchRms.set(row.branchId, (branchRms.get(row.branchId) ?? 0) + n);
  }
  const departmentCount = new Map<string, number>();
  for (const row of perDepartment) {
    if (row.departmentId) departmentCount.set(row.departmentId, row._count._all);
  }
  const gradeCount = new Map<string, number>();
  for (const row of perGrade) {
    if (row.gradeId) gradeCount.set(row.gradeId, row._count._all);
  }

  return {
    active,
    left,
    managers,
    rms,
    employees,
    joinedThisMonth,
    leftThisMonth,
    net: joinedThisMonth - leftThisMonth,
    byBranch: branches.map((branch) => ({
      name: branch.name,
      active: branchTotal.get(branch.id) ?? 0,
      rms: branchRms.get(branch.id) ?? 0,
    })),
    byDepartment: departments.map((department) => ({
      name: department.name,
      active: departmentCount.get(department.id) ?? 0,
    })),
    byGrade: grades.map((grade) => ({ name: grade.name, active: gradeCount.get(grade.id) ?? 0 })),
  };
}

/** How many names a dashboard list prints before it becomes a wall of text. */
const LIST_CAP = 50;

export type LeaveReport = {
  byType: { name: string; daysTaken: number; people: number }[];
  nearlyExhausted: { name: string; employeeId: string | null; type: string; left: number }[];
  /** §6.10: "who has taken none at all, which is itself worth knowing." */
  tookNone: { id: string; name: string; employeeId: string | null }[];
  /** The true figure, which is what the sentence on screen quotes. */
  tookNoneTotal: number;
};

export async function leaveReport(year: number, today: Date = todayInDhaka()): Promise<LeaveReport> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));
  const granted = {
    date: { gte: from, lte: to },
    lengthDays: { gt: 0 },
    leaveRequest: { status: "GRANTED" as const },
  };

  const [types, perType, perTypePerson, tookAny] = await Promise.all([
    prisma.leaveType.findMany({ where: { retiredAt: null }, orderBy: { sortOrder: "asc" } }),
    // Days taken, summed by the database rather than by walking every leave
    // day of the year in memory.
    prisma.leaveDay.groupBy({ by: ["leaveTypeId"], where: granted, _sum: { lengthDays: true } }),
    // One row per person per type, which is how many DISTINCT people took each
    // type. Bounded by headcount times the number of leave types.
    prisma.leaveDay.groupBy({ by: ["leaveTypeId", "employeeId"], where: granted }),
    prisma.leaveDay.groupBy({ by: ["employeeId"], where: granted }),
  ]);

  const tookAnyIds = tookAny.map((row) => row.employeeId);
  const takenByType = new Map(
    perType.map((row) => [row.leaveTypeId, Number(row._sum.lengthDays ?? 0)]),
  );
  const peopleByType = new Map<string, number>();
  for (const row of perTypePerson) {
    peopleByType.set(row.leaveTypeId, (peopleByType.get(row.leaveTypeId) ?? 0) + 1);
  }

  // Asked as a NOT IN rather than by fetching everybody and subtracting, and
  // capped at what the page prints — the count beside it is a real count.
  const [tookNoneTotal, tookNone, entitlements, consumed] = await Promise.all([
    prisma.employee.count({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED", id: { notIn: tookAnyIds } },
    }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED", id: { notIn: tookAnyIds } },
      select: { id: true, fullName: true, employeeId: true },
      orderBy: { fullName: "asc" },
      take: LIST_CAP,
    }),
    // Slim rows and one aggregate, rather than every entitlement carrying its
    // whole consumption array. Bounded by headcount times leave types, and it
    // has to consider everybody: "who is near exhausting their entitlement" is
    // not a question that can be answered from a sample.
    prisma.leaveEntitlement.findMany({
      where: {
        // Buckets in force today. Leave years start on each person's own date,
        // so "this calendar year's entitlement" is no longer a thing to ask for.
        fromDate: { lte: today },
        toDate: { gte: today },
        employee: { status: "ACTIVE", onboardingStatus: "APPROVED" },
      },
      select: {
        id: true,
        days: true,
        employee: { select: { fullName: true, employeeId: true } },
        leaveType: { select: { name: true } },
      },
    }),
    prisma.leaveDayEntitlement.groupBy({ by: ["entitlementId"], _sum: { lengthDays: true } }),
  ]);

  const usedByEntitlement = new Map(
    consumed.map((row) => [row.entitlementId, Number(row._sum.lengthDays ?? 0)]),
  );
  const nearlyExhausted: LeaveReport["nearlyExhausted"] = [];
  for (const entitlement of entitlements) {
    const grantedDays = Number(entitlement.days);
    if (grantedDays <= 0) continue;
    const used = usedByEntitlement.get(entitlement.id) ?? 0;
    const remaining = Math.round((grantedDays - used) * 100) / 100;
    // Within a fifth of running out, which is the point at which a Head of HR
    // wants to know rather than the point at which somebody is refused.
    if (remaining <= grantedDays * 0.2) {
      nearlyExhausted.push({
        name: entitlement.employee.fullName,
        employeeId: entitlement.employee.employeeId,
        type: entitlement.leaveType.name,
        left: remaining,
      });
    }
  }

  return {
    byType: types.map((type) => ({
      name: type.name,
      daysTaken: Math.round((takenByType.get(type.id) ?? 0) * 100) / 100,
      people: peopleByType.get(type.id) ?? 0,
    })),
    nearlyExhausted: nearlyExhausted.sort((a, b) => a.left - b.left).slice(0, 20),
    tookNone: tookNone.map((p) => ({ id: p.id, name: p.fullName, employeeId: p.employeeId })),
    tookNoneTotal,
  };
}

export type DocumentReport = {
  incomplete: { id: string; name: string; employeeId: string | null; missing: number; waitingDays: number }[];
  /** The true figure. `incomplete` is capped at what the page prints. */
  incompleteTotal: number;
};

export async function documentReport(): Promise<DocumentReport> {
  const today = todayInDhaka();

  const [people, held] = await Promise.all([
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED" },
      select: {
        id: true,
        fullName: true,
        employeeId: true,
        staffType: true,
        approvedAt: true,
        createdAt: true,
      },
    }),
    // Which KINDS each person holds, not the documents themselves. The old
    // version pulled every column of every document in the company — storage
    // keys, reviewer names, rejection reasons — to ask nothing more than
    // whether a box was filled.
    prisma.employeeDocument.groupBy({
      by: ["employeeId", "kind"],
      where: {
        supersededAt: null,
        status: { not: "REJECTED" },
        employee: { status: "ACTIVE", onboardingStatus: "APPROVED" },
      },
    }),
  ]);

  const kindsByEmployee = new Map<string, Set<string>>();
  for (const row of held) {
    const set = kindsByEmployee.get(row.employeeId);
    if (set) set.add(row.kind);
    else kindsByEmployee.set(row.employeeId, new Set([row.kind]));
  }

  const incomplete = people
    .map((person) => {
      const mine = kindsByEmployee.get(person.id) ?? new Set<string>();
      const missing = requiredKinds(person.staffType).filter(
        (kind) => kind !== "BANK_DETAILS" && !mine.has(kind),
      ).length;
      const since = person.approvedAt ?? person.createdAt;
      return {
        id: person.id,
        name: person.fullName,
        employeeId: person.employeeId,
        missing,
        waitingDays: Math.max(0, Math.round((today.getTime() - since.getTime()) / 86_400_000)),
      };
    })
    .filter((row) => row.missing > 0)
    .sort((a, b) => b.waitingDays - a.waitingDays);

  // Longest-waiting first, so the cap keeps the ones that matter.
  return { incomplete: incomplete.slice(0, LIST_CAP), incompleteTotal: incomplete.length };
}

export type CertificateReport = {
  expired: number;
  three: number;
  six: number;
  twelve: number;
  withoutCertificate: number;
};

export async function certificateReport(): Promise<CertificateReport> {
  const today = todayInDhaka();
  const [certificates, without] = await Promise.all([
    // Only the expiry date is read, so only the expiry date travels. The
    // ladder itself stays in lib/certificate.ts rather than being re-expressed
    // as SQL date ranges here — two copies of that rule would eventually give
    // the dashboard and the register different answers.
    prisma.rmCertificate.findMany({
      where: { status: "ACTIVE", employee: { status: "ACTIVE" } },
      select: { expiryDate: true },
    }),
    prisma.employee.count({
      where: {
        staffType: "RM",
        status: "ACTIVE",
        onboardingStatus: "APPROVED",
        certificates: { none: { status: "ACTIVE" } },
      },
    }),
  ]);

  return {
    expired: certificates.filter((c) => certificateStatus(c, today).state === "EXPIRED").length,
    three: certificates.filter((c) => expiringWithinMonths(c.expiryDate, 3, today)).length,
    six: certificates.filter((c) => expiringWithinMonths(c.expiryDate, 6, today)).length,
    twelve: certificates.filter((c) => expiringWithinMonths(c.expiryDate, 12, today)).length,
    withoutCertificate: without,
  };
}

export type TerminalReport = { total: number; assigned: number; free: number; atRisk: number };

export async function terminalReport(): Promise<TerminalReport> {
  const today = todayInDhaka();
  const terminals = await prisma.tradingTerminal.findMany({
    select: {
      status: true,
      assignments: {
        where: { releasedOn: null },
        select: {
          employee: {
            select: {
              status: true,
              certificates: { where: { status: "ACTIVE" }, select: { expiryDate: true } },
            },
          },
        },
      },
    },
  });

  const assigned = terminals.filter((t) => t.assignments.length > 0);
  return {
    total: terminals.length,
    assigned: assigned.length,
    free: terminals.filter((t) => t.assignments.length === 0 && t.status === "ACTIVE").length,
    // The §6.9 question, as a single number for the dashboard.
    atRisk: assigned.filter((t) => {
      const employee = t.assignments[0]!.employee;
      const state = certificateStatus(employee.certificates[0] ?? null, today).state;
      return employee.status === "LEFT" || state === "EXPIRED" || state === "NONE";
    }).length,
  };
}

export type AttendanceReport = {
  branches: { name: string; absent: number; late: number; present: number; rate: number }[];
  month: { year: number; month: number };
};

export async function attendanceReport(year: number, month: number): Promise<AttendanceReport> {
  const [sheets, marks] = await Promise.all([
    prisma.attendanceSheet.findMany({
      where: { year, month, status: "PUBLISHED" },
      select: { id: true, branch: { select: { name: true } } },
    }),
    // One row per sheet per mark, rather than one row per person per day. A
    // published month is 412 people times about 30 days; this is a few dozen.
    prisma.attendanceEntry.groupBy({
      by: ["sheetId", "mark"],
      where: { sheet: { year, month, status: "PUBLISHED" } },
      _count: { _all: true },
    }),
  ]);

  const bySheet = new Map<string, Map<string, number>>();
  for (const row of marks) {
    const counts = bySheet.get(row.sheetId) ?? new Map<string, number>();
    counts.set(row.mark, row._count._all);
    bySheet.set(row.sheetId, counts);
  }

  return {
    month: { year, month },
    branches: sheets
      .map((sheet) => {
        const counts = bySheet.get(sheet.id) ?? new Map<string, number>();
        const at = (mark: string) => counts.get(mark) ?? 0;
        const absent = at("ABSENT");
        const late = at("LATE");
        const present = at("PRESENT") + late + at("OFFICIAL_DUTY");
        const working = present + absent;
        return {
          name: sheet.branch.name,
          absent,
          late,
          present,
          rate: working ? Math.round((present / working) * 1000) / 10 : 100,
        };
      })
      // Worst first — §6.10 asks for "the branches with the most absence".
      .sort((a, b) => a.rate - b.rate),
  };
}
