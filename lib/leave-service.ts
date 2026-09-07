import type { Employee, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { toISODate, todayInDhaka } from "./dates";
import {
  allocateFifo,
  audienceIncludes,
  computeBalance,
  isUncounted,
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
  /** Not counted against a balance at all — leave without pay. */
  uncounted: boolean;
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
  const missing = types.filter(
    (t) => !alreadyGranted.has(t.id) && audienceIncludes(t.appliesTo, employee.gender),
  );
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
  return (await leaveTypesForMany([employee], year)).get(employee.id) ?? [];
}

/**
 * The same thing for a whole screen full of people, in the same four queries.
 *
 * The approvals inbox showed one row per application and asked this question
 * once per row — "how much leave that person has left" is in §5.2's list of
 * what an approver must see — so fifty applications cost two hundred queries
 * on the page an HR Head opens every morning.
 *
 * The single-employee case above is the batch of one, deliberately: two
 * implementations of a balance is how the number on the approver's screen ends
 * up disagreeing with the number on the applicant's.
 */
export async function leaveTypesForMany(
  employees: readonly Employee[],
  year: number,
): Promise<Map<string, LeaveTypeView[]>> {
  const result = new Map<string, LeaveTypeView[]>();
  if (!employees.length) return result;

  const ids = [...new Set(employees.map((e) => e.id))];
  const { from, to } = leaveYearBounds(year);

  const [types, entitlements, consumed, pending] = await Promise.all([
    prisma.leaveType.findMany({
      where: { retiredAt: null },
      include: { rules: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.leaveEntitlement.findMany({
      where: { employeeId: { in: ids }, fromDate: { lte: to }, toDate: { gte: from } },
    }),
    // Actually granted leave — the junction, which is the only record of what
    // has left the balance.
    prisma.leaveDayEntitlement.groupBy({
      by: ["entitlementId"],
      where: { leaveDay: { employeeId: { in: ids }, date: { gte: from, lte: to } } },
      _sum: { lengthDays: true },
    }),
    // Applied for and still travelling. Not off the balance yet (§7.1 rule 3),
    // but it cannot be applied for twice either.
    prisma.leaveDay.groupBy({
      by: ["employeeId", "leaveTypeId"],
      where: {
        employeeId: { in: ids },
        date: { gte: from, lte: to },
        leaveRequest: { status: "PENDING" },
      },
      _sum: { lengthDays: true },
    }),
  ]);

  const consumedByEntitlement = new Map(
    consumed.map((row) => [row.entitlementId, Number(row._sum.lengthDays ?? 0)]),
  );
  const pendingByKey = new Map(
    pending.map((row) => [`${row.employeeId}:${row.leaveTypeId}`, Number(row._sum.lengthDays ?? 0)]),
  );
  const bucketsByEmployee = new Map<string, typeof entitlements>();
  for (const entitlement of entitlements) {
    const list = bucketsByEmployee.get(entitlement.employeeId);
    if (list) list.push(entitlement);
    else bucketsByEmployee.set(entitlement.employeeId, [entitlement]);
  }

  for (const employee of employees) {
    if (result.has(employee.id)) continue;
    const mine = bucketsByEmployee.get(employee.id) ?? [];

    result.set(
      employee.id,
      types
        .filter((type) => audienceIncludes(type.appliesTo, employee.gender))
        .map((type) => {
          const buckets: Bucket[] = mine
            .filter((e) => e.leaveTypeId === type.id)
            .map((e) => ({
              id: e.id,
              fromDate: e.fromDate,
              toDate: e.toDate,
              days: Number(e.days),
            }));

          const used = buckets.reduce(
            (total, b) => total + (consumedByEntitlement.get(b.id) ?? 0),
            0,
          );
          const rule = ruleOn(type.rules, to);
          const overBalance = (rule?.overBalance ?? "REFUSE") as "REFUSE" | "WARN";
          const balance = computeBalance(
            buckets,
            used,
            pendingByKey.get(`${employee.id}:${type.id}`) ?? 0,
          );

          return {
            id: type.id,
            code: type.code,
            name: type.name,
            balance,
            overBalance,
            attachmentRequiredAfterDays: rule?.attachmentRequiredAfterDays ?? null,
            // Asked of the RULE, not of the buckets: a type whose rule grants
            // nought days has no buckets, and "no buckets" is also what an
            // employee who joined in December looks like.
            uncounted: isUncounted(Number(rule?.daysPerYear ?? 0), overBalance),
          };
        }),
    );
  }

  return result;
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

/**
 * Consume entitlement for a request that has just been finally approved.
 *
 * This is the moment §7.1 rule 3 describes: "The days come off the balance at
 * this moment and not before." Until now the request has had LeaveDay rows and
 * no junction rows at all.
 *
 * FIFO by bucket start date, so carry-forward burns before this year's grant —
 * the carried days are the ones about to expire, which is what an employee
 * would choose if asked.
 */
export async function consumeEntitlement(
  tx: Prisma.TransactionClient,
  requestId: string,
): Promise<{ shortfall: number }> {
  const days = await tx.leaveDay.findMany({
    where: { leaveRequestId: requestId, lengthDays: { gt: 0 } },
    orderBy: { date: "asc" },
  });
  if (!days.length) return { shortfall: 0 };

  const employeeId = days[0]!.employeeId;
  const leaveTypeId = days[0]!.leaveTypeId;
  const earliest = days[0]!.date;
  const latest = days.at(-1)!.date;

  const buckets = await tx.leaveEntitlement.findMany({
    where: {
      employeeId,
      leaveTypeId,
      fromDate: { lte: latest },
      toDate: { gte: earliest },
    },
  });

  const used = await tx.leaveDayEntitlement.groupBy({
    by: ["entitlementId"],
    where: { entitlementId: { in: buckets.map((b) => b.id) } },
    _sum: { lengthDays: true },
  });
  const usedById = new Map(used.map((u) => [u.entitlementId, Number(u._sum.lengthDays ?? 0)]));

  const { allocations, shortfall } = allocateFifo(
    buckets.map((b) => ({
      id: b.id,
      fromDate: b.fromDate,
      toDate: b.toDate,
      days: Number(b.days),
      alreadyUsed: usedById.get(b.id) ?? 0,
    })),
    days.map((d) => ({ date: d.date, dayKind: d.dayKind, lengthDays: Number(d.lengthDays) })),
  );

  if (allocations.length) {
    await tx.leaveDayEntitlement.createMany({
      data: allocations.map((a) => ({
        leaveDayId: days[a.leaveDayIndex]!.id,
        entitlementId: a.bucketId,
        lengthDays: a.lengthDays,
      })),
    });
  }

  // A shortfall means the person was granted more than they had. It is
  // recorded rather than refused: the approval has already happened, and a
  // silent partial allocation would make the balance lie.
  return { shortfall };
}
