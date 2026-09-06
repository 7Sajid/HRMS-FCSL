"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { chainStart, waitingWith } from "@/lib/approval-chain";
import { fromISODate, formatDate, todayInDhaka } from "@/lib/dates";
import { planLeaveDays, preflight, workingDayCost } from "@/lib/leave";
import {
  bookedDates,
  calendarFor,
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

  const year = from.getUTCFullYear();
  await ensureEntitlements(employee, year);

  const [types, calendar, booked] = await Promise.all([
    leaveTypesFor(employee, year),
    calendarFor(year),
    bookedDates(employee.id),
  ]);

  const type = types.find((t) => t.id === leaveTypeId);
  if (!type) return { error: "Pick a leave type." };

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
    balance: type.balance,
    overBalance: type.overBalance,
    lateReason,
    overlappingDates: booked,
    attachmentRequiredAfterDays: type.attachmentRequiredAfterDays,
    hasAttachment: Boolean(attachmentId),
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
    if (!position.approver) {
      await tx.leaveRequest.update({
        where: { id: created.id },
        data: { status: "GRANTED", decidedAt: new Date(), currentApproverRole: null },
      });
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
