import type { Employee, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { toISODate, todayInDhaka } from "./dates";
import {
  computeBalance,
  leaveYearBounds,
  proRatedDays,
  ruleOn,
  weeklyOffOn,
  type Balance,
  type Bucket,
} from "./leave";

/**
 * Leave, where it meets the database. The arithmetic lives in lib/leave.ts and
 * is tested without any of this.
 */

export type LeaveTypeView = {
  id: string;
  code: string;
  name: string;
  balance: Balance;
  overBalance: "REFUSE" | "WARN";
  attachmentRequiredAfterDays: number | null;
};

/**
 * Grant this year's entitlement if it is not already granted.
 *
 * Idempotent and lazy: called when somebody opens their leave page and when a
 * joiner is approved, so nobody has to remember to run a yearly job before
 * January's first application. A bucket that exists is never touched, so HR's
 * adjustments survive.
 */
export async function ensureEntitlements(employee: Employee, year: number): Promise<void> {
  const { from, to } = leaveYearBounds(year);

  const [types, existing] = await Promise.all([
    prisma.leaveType.findMany({
      where: { retiredAt: null },
      include: { rules: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.leaveEntitlement.findMany({
      where: { employeeId: employee.id, fromDate: from, source: "GRANT" },
      select: { leaveTypeId: true },
    }),
  ]);

  const alreadyGranted = new Set(existing.map((e) => e.leaveTypeId));
  const missing = types.filter((t) => !alreadyGranted.has(t.id));
  if (!missing.length) return;

  const rows: Prisma.LeaveEntitlementCreateManyInput[] = [];
  for (const type of missing) {
    const rule = ruleOn(type.rules, to);
    if (!rule) continue;
    const annual = Number(rule.daysPerYear);
    const days = proRatedDays(annual, employee.joiningDate, year);
    if (days <= 0) continue;
    rows.push({
      employeeId: employee.id,
      leaveTypeId: type.id,
      fromDate: from,
      toDate: to,
      days,
      source: "GRANT",
      note:
        days === annual
          ? `${year} entitlement`
          : `${year} entitlement, pro-rated from the joining date`,
      createdByName: "System",
    });
  }

  if (rows.length) await prisma.leaveEntitlement.createMany({ data: rows });
}

/** Every leave type with this person's balance in it. */
export async function leaveTypesFor(employee: Employee, year: number): Promise<LeaveTypeView[]> {
  const { from, to } = leaveYearBounds(year);

  const [types, entitlements, consumed, pending] = await Promise.all([
    prisma.leaveType.findMany({
      where: { retiredAt: null },
      include: { rules: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.leaveEntitlement.findMany({
      where: { employeeId: employee.id, fromDate: { lte: to }, toDate: { gte: from } },
    }),
    // Actually granted leave — the junction, which is the only record of what
    // has left the balance.
    prisma.leaveDayEntitlement.groupBy({
      by: ["entitlementId"],
      where: { leaveDay: { employeeId: employee.id, date: { gte: from, lte: to } } },
      _sum: { lengthDays: true },
    }),
    // Applied for and still travelling. Not off the balance yet (§7.1 rule 3),
    // but it cannot be applied for twice either.
    prisma.leaveDay.groupBy({
      by: ["leaveTypeId"],
      where: {
        employeeId: employee.id,
        date: { gte: from, lte: to },
        leaveRequest: { status: "PENDING" },
      },
      _sum: { lengthDays: true },
    }),
  ]);

  const consumedByEntitlement = new Map(
    consumed.map((row) => [row.entitlementId, Number(row._sum.lengthDays ?? 0)]),
  );
  const pendingByType = new Map(
    pending.map((row) => [row.leaveTypeId, Number(row._sum.lengthDays ?? 0)]),
  );

  return types.map((type) => {
    const buckets: Bucket[] = entitlements
      .filter((e) => e.leaveTypeId === type.id)
      .map((e) => ({
        id: e.id,
        fromDate: e.fromDate,
        toDate: e.toDate,
        days: Number(e.days),
      }));

    const used = buckets.reduce((total, b) => total + (consumedByEntitlement.get(b.id) ?? 0), 0);
    const rule = ruleOn(type.rules, to);

    return {
      id: type.id,
      code: type.code,
      name: type.name,
      balance: computeBalance(buckets, used, pendingByType.get(type.id) ?? 0),
      overBalance: (rule?.overBalance ?? "REFUSE") as "REFUSE" | "WARN",
      attachmentRequiredAfterDays: rule?.attachmentRequiredAfterDays ?? null,
    };
  });
}

/** The calendar facts every leave calculation needs. */
export async function calendarFor(year: number): Promise<{
  holidays: Set<string>;
  halfDayHolidays: Set<string>;
  weeklyOffDays: readonly number[];
}> {
  const [holidays, weekRules] = await Promise.all([
    prisma.holiday.findMany({ where: { year } }),
    prisma.weeklyOffRule.findMany(),
  ]);
  return {
    holidays: new Set(holidays.map((h) => toISODate(h.date))),
    halfDayHolidays: new Set(holidays.filter((h) => h.halfDay).map((h) => toISODate(h.date))),
    weeklyOffDays: weeklyOffOn(weekRules, todayInDhaka()),
  };
}

/** Dates this person has already applied for and not withdrawn. */
export async function bookedDates(employeeId: string, excludeRequestId?: string): Promise<Set<string>> {
  const days = await prisma.leaveDay.findMany({
    where: {
      employeeId,
      lengthDays: { gt: 0 },
      leaveRequestId: excludeRequestId ? { not: excludeRequestId } : undefined,
      leaveRequest: { status: { in: ["PENDING", "GRANTED"] } },
    },
    select: { date: true },
  });
  return new Set(days.map((d) => toISODate(d.date)));
}

/** How many of this person's team are away on any of these dates. */
export async function teamAwayOn(
  employee: Employee,
  dates: readonly Date[],
): Promise<{ away: number; teamSize: number }> {
  if (!employee.managerId || !dates.length) return { away: 0, teamSize: 1 };

  const [teamSize, away] = await Promise.all([
    prisma.employee.count({ where: { managerId: employee.managerId, status: "ACTIVE" } }),
    prisma.leaveDay
      .findMany({
        where: {
          date: { in: [...dates] },
          lengthDays: { gt: 0 },
          leaveRequest: { status: { in: ["PENDING", "GRANTED"] } },
          employee: { managerId: employee.managerId, status: "ACTIVE", id: { not: employee.id } },
        },
        select: { employeeId: true },
        distinct: ["employeeId"],
      })
      .then((rows) => rows.length),
  ]);

  return { away, teamSize: Math.max(teamSize, 1) };
}
