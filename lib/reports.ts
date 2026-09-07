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

export async function headcount(): Promise<Headcount> {
  const today = todayInDhaka();
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));

  const [people, branches, departments, grades] = await Promise.all([
    prisma.employee.findMany({
      where: { onboardingStatus: "APPROVED" },
      include: { user: { select: { role: true } }, branch: true, department: true, grade: true },
    }),
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.grade.findMany({ orderBy: { rank: "asc" } }),
  ]);

  const active = people.filter((p) => p.status === "ACTIVE");
  const left = people.filter((p) => p.status === "LEFT");

  return {
    active: active.length,
    left: left.length,
    // §6.6: "split into employees, RMs and managers". A manager is counted as
    // a manager rather than twice.
    managers: active.filter((p) => p.user.role === "MANAGER").length,
    rms: active.filter((p) => p.staffType === "RM" && p.user.role !== "MANAGER").length,
    employees: active.filter((p) => p.staffType === "STAFF" && p.user.role !== "MANAGER").length,
    joinedThisMonth: active.filter((p) => p.joiningDate && p.joiningDate >= monthStart).length,
    leftThisMonth: left.filter((p) => p.lastWorkingDay && p.lastWorkingDay >= monthStart).length,
    net:
      active.filter((p) => p.joiningDate && p.joiningDate >= monthStart).length -
      left.filter((p) => p.lastWorkingDay && p.lastWorkingDay >= monthStart).length,
    byBranch: branches.map((branch) => ({
      name: branch.name,
      active: active.filter((p) => p.branchId === branch.id).length,
      rms: active.filter((p) => p.branchId === branch.id && p.staffType === "RM").length,
    })),
    byDepartment: departments.map((department) => ({
      name: department.name,
      active: active.filter((p) => p.departmentId === department.id).length,
    })),
    byGrade: grades.map((grade) => ({
      name: grade.name,
      active: active.filter((p) => p.gradeId === grade.id).length,
    })),
  };
}

export type LeaveReport = {
  byType: { name: string; daysTaken: number; people: number }[];
  nearlyExhausted: { name: string; employeeId: string | null; type: string; left: number }[];
  /** §6.10: "who has taken none at all, which is itself worth knowing." */
  tookNone: { id: string; name: string; employeeId: string | null }[];
};

export async function leaveReport(year: number): Promise<LeaveReport> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year, 11, 31));

  const [types, days, active, entitlements] = await Promise.all([
    prisma.leaveType.findMany({ where: { retiredAt: null }, orderBy: { sortOrder: "asc" } }),
    prisma.leaveDay.findMany({
      where: {
        date: { gte: from, lte: to },
        lengthDays: { gt: 0 },
        leaveRequest: { status: "GRANTED" },
      },
      select: { employeeId: true, leaveTypeId: true, lengthDays: true },
    }),
    prisma.employee.findMany({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED" },
      select: { id: true, fullName: true, employeeId: true },
    }),
    prisma.leaveEntitlement.findMany({
      where: { fromDate: { lte: to }, toDate: { gte: from } },
      include: { leaveType: true, consumption: true },
    }),
  ]);

  const taken = new Map<string, number>();
  const tookAny = new Set<string>();
  for (const day of days) {
    const key = day.leaveTypeId;
    taken.set(key, (taken.get(key) ?? 0) + Number(day.lengthDays));
    tookAny.add(day.employeeId);
  }
  const peopleByType = new Map<string, Set<string>>();
  for (const day of days) {
    const set = peopleByType.get(day.leaveTypeId) ?? new Set<string>();
    set.add(day.employeeId);
    peopleByType.set(day.leaveTypeId, set);
  }

  const byEmployee = new Map(active.map((p) => [p.id, p]));
  const nearlyExhausted: LeaveReport["nearlyExhausted"] = [];
  for (const entitlement of entitlements) {
    const person = byEmployee.get(entitlement.employeeId);
    if (!person) continue;
    const granted = Number(entitlement.days);
    if (granted <= 0) continue;
    const used = entitlement.consumption.reduce((total, c) => total + Number(c.lengthDays), 0);
    const remaining = Math.round((granted - used) * 100) / 100;
    // Within a fifth of running out, which is the point at which a Head of HR
    // wants to know rather than the point at which somebody is refused.
    if (remaining <= granted * 0.2) {
      nearlyExhausted.push({
        name: person.fullName,
        employeeId: person.employeeId,
        type: entitlement.leaveType.name,
        left: remaining,
      });
    }
  }

  return {
    byType: types.map((type) => ({
      name: type.name,
      daysTaken: Math.round((taken.get(type.id) ?? 0) * 100) / 100,
      people: peopleByType.get(type.id)?.size ?? 0,
    })),
    nearlyExhausted: nearlyExhausted.sort((a, b) => a.left - b.left).slice(0, 20),
    tookNone: active
      .filter((p) => !tookAny.has(p.id))
      .map((p) => ({ id: p.id, name: p.fullName, employeeId: p.employeeId })),
  };
}

export type DocumentReport = {
  incomplete: { id: string; name: string; employeeId: string | null; missing: number; waitingDays: number }[];
};

export async function documentReport(): Promise<DocumentReport> {
  const today = todayInDhaka();
  const people = await prisma.employee.findMany({
    where: { status: "ACTIVE", onboardingStatus: "APPROVED" },
    include: { documents: { where: { supersededAt: null, status: { not: "REJECTED" } } } },
  });

  const incomplete = people
    .map((person) => {
      const held = new Set(person.documents.map((d) => d.kind));
      const missing = requiredKinds(person.staffType).filter(
        (kind) => kind !== "BANK_DETAILS" && !held.has(kind),
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

  return { incomplete };
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
    prisma.rmCertificate.findMany({ where: { status: "ACTIVE" } }),
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
    include: {
      assignments: {
        where: { releasedOn: null },
        include: { employee: { include: { certificates: { where: { status: "ACTIVE" } } } } },
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
  const sheets = await prisma.attendanceSheet.findMany({
    where: { year, month, status: "PUBLISHED" },
    include: { branch: true, entries: { select: { mark: true } } },
  });

  return {
    month: { year, month },
    branches: sheets
      .map((sheet) => {
        const absent = sheet.entries.filter((e) => e.mark === "ABSENT").length;
        const late = sheet.entries.filter((e) => e.mark === "LATE").length;
        const present = sheet.entries.filter(
          (e) => e.mark === "PRESENT" || e.mark === "LATE" || e.mark === "OFFICIAL_DUTY",
        ).length;
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
