"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { fromISODate } from "@/lib/dates";
import { leaveYearBounds } from "@/lib/leave";

export type SetupResult = { ok: true } | { error: string };

const schema = z.object({
  effectiveFrom: z.string().trim().min(1, "Set the date this takes effect."),
  reason: z.enum(["TRANSFER", "PROMOTION", "MANAGER_CHANGE", "CORRECTION"]),
  branchId: z.string().trim().optional().default(""),
  departmentId: z.string().trim().optional().default(""),
  designationId: z.string().trim().optional().default(""),
  gradeId: z.string().trim().optional().default(""),
  managerId: z.string().trim().optional().default(""),
  note: z.string().trim().max(300).optional().default(""),
});

/**
 * §5.3 page 5 — "A transfer is recorded as a dated event, never by
 * overwriting: the old branch keeps its history, the new branch takes over
 * from the transfer date."
 *
 * That is also what keeps §5.2 true: a manager keeps access to the period
 * somebody reported to them, because the period is a row rather than a
 * property that got replaced.
 */
export async function recordAssignment(
  employeeId: string,
  _previous: unknown,
  formData: FormData,
): Promise<SetupResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "employees.setup")) return { error: "You cannot change staff records." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const effectiveFrom = fromISODate(parsed.data.effectiveFrom);
  if (!effectiveFrom) return { error: "That is not a date." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { assignments: { where: { effectiveTo: null }, orderBy: { effectiveFrom: "desc" } } },
  });
  if (!employee) return { error: "Not found." };
  if (employee.status === "LEFT") return { error: "This person has left. Their record is closed." };

  const open = employee.assignments[0];
  if (open && effectiveFrom < open.effectiveFrom) {
    return {
      error: "That date is before their current posting started. A transfer cannot run backwards.",
    };
  }

  // Carry forward anything left blank, so a transfer that only changes the
  // branch does not silently erase the department.
  const next = {
    branchId: parsed.data.branchId || open?.branchId || null,
    departmentId: parsed.data.departmentId || open?.departmentId || null,
    designationId: parsed.data.designationId || open?.designationId || null,
    gradeId: parsed.data.gradeId || open?.gradeId || null,
    managerId: parsed.data.managerId || open?.managerId || null,
  };

  if (next.managerId === employeeId) return { error: "Somebody cannot report to themselves." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    // The old posting is CLOSED, not deleted. It is the record of where this
    // person was and who they answered to for that period.
    if (open) {
      await tx.employeeAssignment.update({
        where: { id: open.id },
        data: { effectiveTo: new Date(effectiveFrom.getTime() - 86_400_000) },
      });
    }

    await tx.employeeAssignment.create({
      data: {
        employeeId,
        effectiveFrom,
        ...next,
        reason: parsed.data.reason,
        note: parsed.data.note,
        recordedById: context.user.id,
        recordedByName: actorName,
      },
    });

    // The employee row's pointers are a cache of the open assignment.
    await tx.employee.update({ where: { id: employeeId }, data: next });

    await record({
      action: "employee.assigned",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: {
        reason: parsed.data.reason,
        effectiveFrom: parsed.data.effectiveFrom,
        from: {
          branchId: open?.branchId ?? null,
          departmentId: open?.departmentId ?? null,
          designationId: open?.designationId ?? null,
          gradeId: open?.gradeId ?? null,
          managerId: open?.managerId ?? null,
        },
        to: next,
        note: parsed.data.note || undefined,
      },
      ip,
      tx,
    });

    await notify(
      {
        userId: employee.userId,
        title:
          parsed.data.reason === "PROMOTION"
            ? "Your designation has changed"
            : "Your posting has changed",
        body: parsed.data.note || "HR has updated your employment details.",
        link: "/me/profile",
      },
      tx,
    );
  });

  revalidatePath(`/hr/employees/${employeeId}`);
  revalidatePath("/hr/employees");
  return { ok: true };
}

/** §5.1 page 3 — HR's one-click approval of an emergency contact change. */
export async function decideContactChange(
  contactId: string,
  approve: boolean,
  reason: string,
): Promise<SetupResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "employees.setup")) return { error: "You cannot do that." };

  const pending = await prisma.emergencyContact.findUnique({
    where: { id: contactId },
    include: { employee: true },
  });
  if (!pending || pending.status !== "PENDING") return { error: "Not found." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    if (approve) {
      // The old row becomes SUPERSEDED rather than disappearing — §5.1:
      // "the previous version is kept."
      if (pending.supersedesId) {
        await tx.emergencyContact.update({
          where: { id: pending.supersedesId },
          data: { status: "SUPERSEDED", approvedAt: new Date() },
        });
      } else {
        await tx.emergencyContact.updateMany({
          where: {
            employeeId: pending.employeeId,
            slot: pending.slot,
            status: "CURRENT",
          },
          data: { status: "SUPERSEDED", approvedAt: new Date() },
        });
      }
      await tx.emergencyContact.update({
        where: { id: contactId },
        data: {
          status: "CURRENT",
          approvedById: context.user.id,
          approvedByName: actorName,
          approvedAt: new Date(),
        },
      });
    } else {
      await tx.emergencyContact.update({
        where: { id: contactId },
        data: { status: "SUPERSEDED", rejectionReason: reason.trim().slice(0, 300) },
      });
    }

    await record({
      action: approve ? "contact.approved" : "contact.rejected",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: pending.employeeId,
      targetLabel: pending.employee.fullName,
      detail: { slot: pending.slot, reason: reason || undefined },
      ip,
      tx,
    });

    await notify(
      {
        userId: pending.employee.userId,
        title: approve
          ? "Your emergency contact change is approved"
          : "Your emergency contact change was not approved",
        body: approve ? "It is now the number we would ring." : reason,
        link: "/me/emergency-contacts",
      },
      tx,
    );
  });

  revalidatePath(`/hr/employees/${pending.employeeId}`);
  revalidatePath("/me/emergency-contacts");
  return { ok: true };
}

/** §5.1 page 1 — HR answers a correction request. */
export async function resolveCorrection(
  id: string,
  resolved: boolean,
  response: string,
): Promise<SetupResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "employees.setup")) return { error: "You cannot do that." };

  const request = await prisma.correctionRequest.findUnique({
    where: { id },
    include: { employee: true },
  });
  if (!request || request.status !== "OPEN") return { error: "Not found." };

  const written = response.trim().slice(0, 500);
  if (!resolved && written.length < 5) {
    return { error: "Say why it is not being changed. They see exactly what you write." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;

  await prisma.$transaction(async (tx) => {
    await tx.correctionRequest.update({
      where: { id },
      data: {
        status: resolved ? "RESOLVED" : "DECLINED",
        response: written,
        handledById: context.user.id,
        handledByName: actorName,
        handledAt: new Date(),
      },
    });
    await record({
      action: resolved ? "correction.resolved" : "correction.declined",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: request.employeeId,
      targetLabel: request.employee.fullName,
      detail: { asked: request.message, answered: written || undefined },
      ip: await currentIp(),
      tx,
    });
    await notify(
      {
        userId: request.employee.userId,
        title: resolved ? "HR made your correction" : "HR looked at your correction request",
        body: written,
        link: "/me/profile",
      },
      tx,
    );
  });

  revalidatePath(`/hr/employees/${request.employeeId}`);
  return { ok: true };
}

/**
 * Add days to somebody's balance, or take them away (§6.2).
 *
 * There was no way to do either. `ensureEntitlements` says "a bucket that
 * exists is never touched, so HR's adjustments survive" and nothing anywhere
 * created one; `consumeEntitlement` records a shortfall when leave is granted
 * beyond entitlement "rather than refusing it", leaving a discrepancy nobody
 * could ever close.
 *
 * Written as a new dated bucket, never by editing the grant. Rule 8, and the
 * same reason leave rules are dated: last year's arithmetic must still come
 * out the same, and "who changed this, when, and why" has to have an answer.
 * A negative bucket reduces what was entitled and funds nothing — `allocateFifo`
 * only ever draws from a bucket with days left in it.
 */
export async function adjustLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  year: number,
  days: number,
  reason: string,
): Promise<SetupResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "employees.setup")) return { error: "You cannot do that." };

  const written = reason.trim().slice(0, 500);
  if (written.length < 5) {
    return { error: "Say why. This is read whenever somebody asks about their balance." };
  }
  if (!Number.isFinite(days) || days === 0) return { error: "Enter a number of days, up or down." };
  // Half days are real; a hundred days of adjustment is a typo.
  if (Math.abs(days) > 366) return { error: "That is more than a year. Check the number." };
  if (Math.round(days * 2) !== days * 2) return { error: "Days go in halves — 1, 1.5, 2." };

  const [employee, leaveType] = await Promise.all([
    prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true } }),
    prisma.leaveType.findUnique({ where: { id: leaveTypeId }, select: { id: true, name: true } }),
  ]);
  if (!employee || !leaveType) return { error: "Not found." };

  const { from, to } = leaveYearBounds(year);
  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.leaveEntitlement.create({
      data: {
        employeeId,
        leaveTypeId,
        fromDate: from,
        toDate: to,
        days,
        source: "ADJUSTMENT",
        note: written,
        createdById: context.user.id,
        createdByName: actorName,
      },
    });
    await record({
      action: "leave.adjusted",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: `${employee.fullName} — ${leaveType.name}`,
      detail: { year, days, reason: written },
      ip,
      tx,
    });
    await notify(
      {
        userId: (await tx.employee.findUniqueOrThrow({
          where: { id: employeeId },
          select: { userId: true },
        })).userId,
        title: `Your ${leaveType.name.toLowerCase()} balance has changed`,
        body: `${days > 0 ? "+" : ""}${days} day${Math.abs(days) === 1 ? "" : "s"} for ${year}. ${written}`,
        link: "/me/leave",
      },
      tx,
    );
  });

  revalidatePath(`/hr/employees/${employeeId}`);
  revalidatePath("/me/leave");
  return { ok: true };
}
