import type { Employee, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { addDays, addYears, formatDate, toISODate, todayInDhaka } from "./dates";
import {
  allocateFifo,
  audienceIncludes,
  carriedForwardDays,
  computeBalance,
  grantWindow,
  isUncounted,
  leaveYearOf,
  probationEnds,
  ruleForPeriod,
  weeklyOffOn,
  yearsSpanned,
  type Balance,
  type Bucket,
  type LeavePeriod,
  type ProbationPolicy,
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
  /** What this type does during probation (lib/leave.ts). */
  probation: ProbationPolicy;
  /**
   * The day it opens, when that is still to come — earned leave during
   * probation. Null when it can be taken now.
   */
  availableFrom: Date | null;
  /** The leave year this balance belongs to. */
  period: LeavePeriod;
  /** The buckets behind the balance, so two years drawing on one can be merged. */
  bucketIds: string[];
};

const sameDay = (a: Date, b: Date) => a.getTime() === b.getTime();
const span = (p: LeavePeriod) => `${formatDate(p.from)} – ${formatDate(p.to)}`;

/**
 * Grant the entitlement for the leave year containing `onDate`, if it is not
 * already granted.
 *
 * Idempotent and lazy: called when somebody opens their leave page and when a
 * joiner is approved, so nobody has to remember to run a job before anybody's
 * anniversary. A bucket that exists is never touched, so HR's adjustments
 * survive.
 *
 * A grant is recognised by the day its window closes. An ADVANCE type's
 * probation year and first permanent year share one window, so opening the
 * leave page in either finds the same bucket instead of granting it twice.
 */
export async function ensureEntitlements(employee: Employee, onDate: Date): Promise<void> {
  const period = leaveYearOf(employee.joiningDate, onDate);
  const previous = leaveYearOf(employee.joiningDate, addDays(period.from, -1));
  // A first leave year has nothing before it to carry from.
  const hadPreviousYear = !employee.joiningDate || previous.to >= employee.joiningDate;

  const [types, existing, lastYear, usedLastYear] = await Promise.all([
    prisma.leaveType.findMany({
      where: { retiredAt: null },
      include: { rules: true },
      orderBy: { sortOrder: "asc" },
    }),
    // Every bucket still open once this year starts: this year's own, and an
    // advance window that runs on past it.
    prisma.leaveEntitlement.findMany({
      where: { employeeId: employee.id, toDate: { gte: period.from } },
      select: { leaveTypeId: true, source: true, toDate: true },
    }),
    prisma.leaveEntitlement.findMany({
      where: { employeeId: employee.id, toDate: previous.to },
      select: { id: true, leaveTypeId: true, days: true },
    }),
    prisma.leaveDayEntitlement.groupBy({
      by: ["entitlementId"],
      where: { entitlement: { employeeId: employee.id, toDate: previous.to } },
      _sum: { lengthDays: true },
    }),
  ]);

  const has = (leaveTypeId: string, source: "GRANT" | "CARRY_FORWARD", toDate: Date) =>
    existing.some(
      (e) => e.leaveTypeId === leaveTypeId && e.source === source && sameDay(e.toDate, toDate),
    );
  const usedById = new Map(
    usedLastYear.map((row) => [row.entitlementId, Number(row._sum.lengthDays ?? 0)]),
  );

  const rows: Prisma.LeaveEntitlementCreateManyInput[] = [];
  for (const type of types) {
    if (!audienceIncludes(type.appliesTo, employee.gender)) continue;

    const window = grantWindow(
      type.probation,
      employee.joiningDate,
      employee.confirmationDate,
      period,
    );
    if (window && !has(type.id, "GRANT", window.to)) {
      const rule = ruleForPeriod(type.rules, window.rulePeriod);
      const days = Number(rule?.daysPerYear ?? 0);
      if (days > 0) {
        rows.push({
          employeeId: employee.id,
          leaveTypeId: type.id,
          fromDate: window.from,
          toDate: window.to,
          days,
          source: "GRANT",
          note:
            window.from < window.rulePeriod.from
              ? `Leave year ${span(window.rulePeriod)}, usable during probation`
              : window.from > window.rulePeriod.from
                ? `Leave year ${span(window.rulePeriod)}, from the end of probation`
                : `Leave year ${span(window.rulePeriod)}`,
          createdByName: "System",
        });
      }
    }

    // §12.2 — what last year's rule said about carrying, because that is the
    // rule those days were earned under.
    if (!hadPreviousYear || has(type.id, "CARRY_FORWARD", period.to)) continue;
    const lastYearRule = ruleForPeriod(type.rules, previous);
    if (!lastYearRule?.carryForward) continue;

    const mine = lastYear.filter((e) => e.leaveTypeId === type.id);
    if (!mine.length) continue;
    const grantedLastYear = mine.reduce((total, e) => total + Number(e.days), 0);
    const consumedLastYear = mine.reduce((total, e) => total + (usedById.get(e.id) ?? 0), 0);
    const carriedDays = carriedForwardDays(
      grantedLastYear,
      consumedLastYear,
      lastYearRule.carryForwardCap === null ? null : Number(lastYearRule.carryForwardCap),
    );
    if (carriedDays <= 0) continue;

    rows.push({
      employeeId: employee.id,
      leaveTypeId: type.id,
      // Valid for the whole of this leave year and then gone. FIFO draws it
      // before this year's grant — see `carriedForward` on Bucket — so the days
      // that lapse are the ones that get used.
      fromDate: period.from,
      toDate: period.to,
      days: carriedDays,
      source: "CARRY_FORWARD",
      note: `Carried forward from the leave year ${span(previous)}${
        lastYearRule.carryForwardCap !== null &&
        grantedLastYear - consumedLastYear > Number(lastYearRule.carryForwardCap)
          ? `, capped at ${Number(lastYearRule.carryForwardCap)}`
          : ""
      }`,
      createdByName: "System",
    });
  }

  if (rows.length) await prisma.leaveEntitlement.createMany({ data: rows });
}

/** Every leave type with this person's balance, for the leave year containing `onDate`. */
export async function leaveTypesFor(employee: Employee, onDate: Date): Promise<LeaveTypeView[]> {
  return (await leaveTypesForMany([employee], onDate)).get(employee.id) ?? [];
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
  onDate: Date,
): Promise<Map<string, LeaveTypeView[]>> {
  const result = new Map<string, LeaveTypeView[]>();
  if (!employees.length) return result;

  const ids = [...new Set(employees.map((e) => e.id))];
  // Everybody's leave year is their own, so the batch asks for the span that
  // covers all of them and picks each person's rows out below.
  const periods = new Map(employees.map((e) => [e.id, leaveYearOf(e.joiningDate, onDate)]));
  const all = [...periods.values()];
  const from = new Date(Math.min(...all.map((p) => p.from.getTime())));
  const to = new Date(Math.max(...all.map((p) => p.to.getTime())));
  const overlapping = { employeeId: { in: ids }, fromDate: { lte: to }, toDate: { gte: from } };

  const [types, entitlements, consumed, pending] = await Promise.all([
    prisma.leaveType.findMany({
      where: { retiredAt: null },
      include: { rules: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.leaveEntitlement.findMany({ where: overlapping }),
    // Actually granted leave — the junction, which is the only record of what
    // has left the balance. Everything ever drawn from those buckets, whatever
    // date it was for: an advance bucket's probation days fall before the year
    // on screen and still came out of it.
    prisma.leaveDayEntitlement.groupBy({
      by: ["entitlementId"],
      where: { entitlement: overlapping },
      _sum: { lengthDays: true },
    }),
    // Applied for and still travelling. Not off the balance yet (§7.1 rule 3),
    // but it cannot be applied for twice either. A year either side, because an
    // advance bucket reaches that far; each day is matched to its own buckets'
    // window below.
    prisma.leaveDay.findMany({
      where: {
        employeeId: { in: ids },
        lengthDays: { gt: 0 },
        date: { gte: addYears(from, -1), lte: addYears(to, 1) },
        leaveRequest: { status: "PENDING" },
      },
      select: { employeeId: true, leaveTypeId: true, date: true, lengthDays: true },
    }),
  ]);

  const consumedByEntitlement = new Map(
    consumed.map((row) => [row.entitlementId, Number(row._sum.lengthDays ?? 0)]),
  );
  const bucketsByEmployee = new Map<string, typeof entitlements>();
  for (const entitlement of entitlements) {
    const list = bucketsByEmployee.get(entitlement.employeeId);
    if (list) list.push(entitlement);
    else bucketsByEmployee.set(entitlement.employeeId, [entitlement]);
  }

  for (const employee of employees) {
    if (result.has(employee.id)) continue;
    const period = periods.get(employee.id)!;
    const ends = probationEnds(employee.joiningDate, employee.confirmationDate);
    const mine = (bucketsByEmployee.get(employee.id) ?? []).filter(
      (e) => e.fromDate <= period.to && e.toDate >= period.from,
    );

    result.set(
      employee.id,
      types
        .filter((type) => audienceIncludes(type.appliesTo, employee.gender))
        .map((type) => {
          const own = mine.filter((e) => e.leaveTypeId === type.id);
          const buckets: Bucket[] = own.map((e) => ({
            id: e.id,
            fromDate: e.fromDate,
            toDate: e.toDate,
            days: Number(e.days),
            carriedForward: e.source === "CARRY_FORWARD",
          }));

          const used = buckets.reduce(
            (total, b) => total + (consumedByEntitlement.get(b.id) ?? 0),
            0,
          );
          // Pending days count if they fall anywhere these buckets would pay
          // for: the year itself, stretched over probation for an advance.
          const windowFrom = Math.min(period.from.getTime(), ...own.map((e) => e.fromDate.getTime()));
          const windowTo = Math.max(period.to.getTime(), ...own.map((e) => e.toDate.getTime()));
          const pendingDays = pending.reduce(
            (total, day) =>
              day.employeeId === employee.id &&
              day.leaveTypeId === type.id &&
              day.date.getTime() >= windowFrom &&
              day.date.getTime() <= windowTo
                ? total + Number(day.lengthDays)
                : total,
            0,
          );
          const rule = ruleForPeriod(type.rules, period);
          const overBalance = (rule?.overBalance ?? "REFUSE") as "REFUSE" | "WARN";

          return {
            id: type.id,
            code: type.code,
            name: type.name,
            balance: computeBalance(buckets, used, pendingDays),
            overBalance,
            attachmentRequiredAfterDays: rule?.attachmentRequiredAfterDays ?? null,
            // Asked of the RULE, not of the buckets: a type whose rule grants
            // nought days has no buckets, and "no buckets" is also what earned
            // leave looks like during probation.
            uncounted: isUncounted(Number(rule?.daysPerYear ?? 0), overBalance),
            probation: type.probation,
            availableFrom:
              type.probation === "AFTER_PROBATION" && ends !== null && onDate < ends ? ends : null,
            period,
            bucketIds: own.map((e) => e.id),
          };
        }),
    );
  }

  return result;
}

/** The calendar facts every leave calculation needs. */
/**
 * The calendar over a whole range, however many years it touches.
 *
 * `calendarFor(year)` reads one year and is right for a screen that shows one
 * year. It was also what an application read, so an application starting on 28
 * December never learned about January's public holidays and charged them as
 * working days.
 */
export async function calendarForRange(from: Date, to: Date): Promise<{
  holidays: Set<string>;
  halfDayHolidays: Set<string>;
  weeklyOffDays: readonly number[];
}> {
  const years = yearsSpanned(from, to);
  const [holidays, weekRules] = await Promise.all([
    prisma.holiday.findMany({ where: { year: { in: years } } }),
    prisma.weeklyOffRule.findMany(),
  ]);
  return {
    holidays: new Set(holidays.map((h) => toISODate(h.date))),
    halfDayHolidays: new Set(holidays.filter((h) => h.halfDay).map((h) => toISODate(h.date))),
    weeklyOffDays: weeklyOffOn(weekRules, todayInDhaka()),
  };
}

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
      carriedForward: b.source === "CARRY_FORWARD",
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
