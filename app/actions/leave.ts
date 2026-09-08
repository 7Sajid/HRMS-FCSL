"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { chainStart, waitingWith } from "@/lib/approval-chain";
import { fromISODate, formatDate, todayInDhaka } from "@/lib/dates";
import { planLeaveDays, preflight, workingDayCost, yearsSpanned } from "@/lib/leave";
import {
  bookedDates,
  calendarForRange,
  consumeEntitlement,
  ensureEntitlements,
  leaveTypesFor,
  teamAwayOn,
} from "@/lib/leave-service";

export type LeaveResult =
  | { ok: true; id: string; warnings: string[] }
  | { error: string; problems?: string[] };

/**
 * Apply for leave (§6.2).
 *
 * Every check the screen showed is run again here. The preview is a courtesy;
 * this is the rule. A server action is a callable HTTP endpoint, and a
 * disabled button stops nobody who does not use the button.
 */
export async function applyForLeave(_previous: unknown, formData: FormData): Promise<LeaveResult> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };
  const employee = context.employee;
  if (employee.onboardingStatus !== "APPROVED") return { error: "Your panel is not open yet." };
  if (employee.status === "LEFT") return { error: "This account is closed." };

  const leaveTypeId = String(formData.get("leaveTypeId") ?? "");
  const from = fromISODate(String(formData.get("from") ?? ""));
  const to = fromISODate(String(formData.get("to") ?? ""));
  const reason = String(formData.get("reason") ?? "").trim();
  const lateReason = String(formData.get("lateReason") ?? "").trim();
  const attachmentId = String(formData.get("attachmentId") ?? "").trim() || null;

  if (!from || !to) return { error: "Pick the first and last day." };
  if (reason.length < 3) return { error: "Please write a short reason." };

  // The attachment has to be one of their own files. It arrives as an id in a
  // form field, so without this any document id in the system could be cited —
  // and while the FILE itself stays unreadable (app/api/download re-checks),
  // the citation alone puts somebody else's medical certificate on the record
  // as the evidence for this application. Asked in the query: a document that
  // is not theirs simply does not match.
  if (attachmentId) {
    const own = await prisma.employeeDocument.findFirst({
      where: { id: attachmentId, employeeId: employee.id, purgedAt: null },
      select: { id: true },
    });
    if (!own) return { error: "Pick one of your own uploaded documents." };
  }

  // Every year the dates touch, not just the first one. A week off over
  // Christmas is two leave years, and both of them have holidays and an
  // entitlement of their own.
  const years = yearsSpanned(from, to);
  for (const year of years) await ensureEntitlements(employee, year);

  const [byYear, calendar, booked] = await Promise.all([
    Promise.all(years.map(async (year) => ({ year, types: await leaveTypesFor(employee, year) }))),
    calendarForRange(from, to),
    bookedDates(employee.id),
  ]);

  const types = byYear[0]!.types;
  const type = types.find((t) => t.id === leaveTypeId);
  if (!type) return { error: "Pick a leave type." };

  // The same leave type in each year, with that year's balance against it. A
  // type retired between the two years simply has no entry for the later one.
  const balances = byYear
    .map(({ year, types: yearTypes }) => {
      const match = yearTypes.find((t) => t.id === leaveTypeId);
      return match ? { year, balance: match.balance } : null;
    })
    .filter((entry): entry is { year: number; balance: (typeof type)["balance"] } => entry !== null);

  const days = planLeaveDays(
    from,
    to,
    calendar.holidays,
    calendar.halfDayHolidays,
    calendar.weeklyOffDays,
  );
  const { away, teamSize } = await teamAwayOn(
    employee,
    days.filter((d) => d.lengthDays > 0).map((d) => d.date),
  );

  const checks = preflight({
    from,
    to,
    today: todayInDhaka(),
    days,
    balances,
    overBalance: type.overBalance,
    lateReason,
    overlappingDates: booked,
    attachmentRequiredAfterDays: type.attachmentRequiredAfterDays,
    hasAttachment: Boolean(attachmentId),
    uncounted: type.uncounted,
    teamAwayCount: away,
    teamSize,
  });
  if (!checks.ok) return { error: checks.errors[0]!, problems: checks.errors };

  const position = chainStart(context.user.role);
  const cost = workingDayCost(days);
  const ip = await currentIp();

  const request = await prisma.$transaction(async (tx) => {
    const created = await tx.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId,
        reason,
        lateReason,
        attachmentId,
        status: "PENDING",
        currentStep: 0,
        // A Super Admin has no chain, so their leave is recorded directly.
        currentApproverRole: position.approver,
      },
    });

    await tx.leaveDay.createMany({
      data: days.map((day) => ({
        leaveRequestId: created.id,
        employeeId: employee.id,
        leaveTypeId,
        date: day.date,
        dayKind: day.dayKind,
        lengthDays: day.lengthDays,
      })),
    });

    // §7.1: the Super Admin needs no approval. Recorded directly — and the
    // days come off at once, because there is no chain to travel.
    //
    // Granting is TWO things: the status changes and the entitlement is
    // consumed. This branch used to do only the first, so a Super Admin's
    // balance stayed permanently full however much leave they took. The
    // chained path in `lib/leave-decide.ts` does both; so does this one now.
    let shortfall = 0;
    if (!position.approver) {
      await tx.leaveRequest.update({
        where: { id: created.id },
        data: { status: "GRANTED", decidedAt: new Date(), currentApproverRole: null },
      });
      ({ shortfall } = await consumeEntitlement(tx, created.id));
    }

    await record({
      action: "leave.applied",
      actor: actorFrom({ ...context.user, fullName: employee.fullName }),
      targetType: "leaveRequest",
      targetId: created.id,
      targetLabel: `${employee.fullName} — ${type.name}`,
      detail: {
        from: formatDate(from),
        to: formatDate(to),
        workingDays: cost,
        goesTo: position.approver ?? "recorded directly",
      },
      ip,
      tx,
    });

    // A granted leave writes a "granted" line whoever granted it. Without this
    // the register of leave actually granted would be silently missing every
    // Super Admin's own.
    if (!position.approver) {
      await record({
        action: "leave.granted",
        actor: actorFrom({ ...context.user, fullName: employee.fullName }),
        targetType: "leaveRequest",
        targetId: created.id,
        targetLabel: `${employee.fullName} — ${type.name}`,
        detail: {
          workingDays: cost,
          from: formatDate(from),
          to: formatDate(to),
          approvers: [`${employee.fullName} — recorded directly, no approval chain`],
          ...(shortfall > 0 ? { entitlementShortfall: shortfall } : {}),
        },
        ip,
        tx,
      });
    }

    // One inbox at a time (§7.1 rule 1): only the first approver is told.
    if (position.approver) {
      const approvers = await approverUsers(tx, position.approver, employee.managerId);
      await notify(
        approvers.map((u) => ({
          userId: u.id,
          title: `${employee.fullName} applied for ${cost} day${cost === 1 ? "" : "s"} of ${type.name.toLowerCase()}`,
          body: `${formatDate(from)} to ${formatDate(to)}`,
          link: position.approver === "MANAGER" ? "/team/approvals" : "/hr/approvals",
        })),
        tx,
      );
    }

    return created;
  });

  revalidatePath("/me/leave");
  return { ok: true, id: request.id, warnings: checks.warnings };
}

/**
 * Who holds the inbox at this step.
 *
 * A manager step means THIS person's manager, not every manager in the
 * company. Everything above is a role held by one or two people.
 */
async function approverUsers(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  role: string,
  managerEmployeeId: string | null,
): Promise<{ id: string }[]> {
  if (role === "MANAGER") {
    if (!managerEmployeeId) return [];
    const manager = await tx.employee.findUnique({
      where: { id: managerEmployeeId },
      select: { userId: true },
    });
    return manager ? [{ id: manager.userId }] : [];
  }
  return tx.user.findMany({
    where: { role: role as never, disabledAt: null },
    select: { id: true },
  });
}

/**
 * §6.2: "An employee can withdraw an application that has not yet been fully
 * approved, and can request cancellation of one already approved if the dates
 * have not started."
 */
export async function withdrawLeave(requestId: string): Promise<{ ok: true } | { error: string }> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };

  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: { days: { orderBy: { date: "asc" } }, leaveType: true },
  });
  // Somebody else's application is not something to explain — it is something
  // not to acknowledge.
  if (!request || request.employeeId !== context.employee.id) return { error: "Not found." };

  const firstDay = request.days[0]?.date;
  const started = firstDay ? firstDay <= todayInDhaka() : false;

  if (request.status === "PENDING") {
    // Still travelling: withdraw it outright.
  } else if (request.status === "GRANTED" && !started) {
    // Approved but not begun: cancelled, and the days go back.
  } else if (request.status === "GRANTED") {
    return { error: "These dates have already started. Ask HR to change it." };
  } else {
    return { error: "This application is already closed." };
  }

  const cancelling = request.status === "GRANTED";
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.leaveRequest.update({
      where: { id: request.id },
      data: {
        status: cancelling ? "CANCELLED" : "WITHDRAWN",
        currentApproverRole: null,
        decidedAt: new Date(),
      },
    });

    // Release the entitlement exactly — the junction knows which bucket funded
    // which day, so cancelling gives back precisely what was taken.
    await tx.leaveDayEntitlement.deleteMany({
      where: { leaveDay: { leaveRequestId: request.id } },
    });

    await record({
      action: cancelling ? "leave.cancelled" : "leave.withdrawn",
      actor: actorFrom({ ...context.user, fullName: context.employee!.fullName }),
      targetType: "leaveRequest",
      targetId: request.id,
      targetLabel: `${context.employee!.fullName} — ${request.leaveType.name}`,
      detail: { wasStatus: request.status },
      ip,
      tx,
    });
  });

  revalidatePath("/me/leave");
  return { ok: true };
}

export { waitingWith };
