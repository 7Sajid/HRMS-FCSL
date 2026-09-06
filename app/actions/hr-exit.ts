"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { fromISODate } from "@/lib/dates";
import { CLEARANCE_CHECKLIST, exitBlockers, purgeDateFor } from "@/lib/exit";

export type ExitResult = { ok: true } | { error: string };

const schema = z.object({
  reason: z.enum(["RESIGNATION", "END_OF_CONTRACT", "TERMINATION", "RETIREMENT"]),
  lastWorkingDay: z.string().trim().min(1, "Set their last working day."),
  reasonNote: z.string().trim().max(500).optional().default(""),
});

/**
 * Step 1 — record the departure (§6.6).
 *
 * Recording is not completing. The clearance checklist is created here and the
 * exit stays open until every line is ticked and the terminal is released.
 */
export async function recordExit(
  employeeId: string,
  _previous: unknown,
  formData: FormData,
): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot record a leaver." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const lastWorkingDay = fromISODate(parsed.data.lastWorkingDay);
  if (!lastWorkingDay) return { error: "That is not a date." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { exit: true },
  });
  if (!employee) return { error: "Not found." };
  if (employee.exit) return { error: "An exit is already recorded for this person." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.exit.create({
      data: {
        employeeId,
        reason: parsed.data.reason,
        reasonNote: parsed.data.reasonNote,
        lastWorkingDay,
        recordedById: context.user.id,
        recordedByName: actorName,
        // §12.2: one year after the last working day the FILES go; the record
        // stays permanently so headcount reports remain correct.
        documentsPurgeAfter: purgeDateFor(lastWorkingDay),
        clearanceItems: { create: CLEARANCE_CHECKLIST.map((item) => ({ ...item })) },
      },
    });

    await tx.employee.update({ where: { id: employeeId }, data: { lastWorkingDay } });

    await record({
      action: "exit.recorded",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: {
        reason: parsed.data.reason,
        lastWorkingDay: parsed.data.lastWorkingDay,
        note: parsed.data.reasonNote || undefined,
      },
      ip,
      tx,
    });

    // §8: HR Head, their manager, and IT and Accounts for clearance.
    const toTell = await tx.user.findMany({
      where: { role: { in: ["HR_HEAD", "HR_EXECUTIVE"] }, disabledAt: null },
      select: { id: true },
    });
    await notify(
      toTell.map((u) => ({
        userId: u.id,
        title: `${employee.fullName} is leaving`,
        body: `Last working day ${parsed.data.lastWorkingDay}. Clearance has been opened.`,
        link: `/hr/exits/${employeeId}`,
      })),
      tx,
    );
  });

  revalidatePath("/hr/exits");
  return { ok: true };
}

/** Step 2 — each line ticked off by the department responsible. */
export async function clearItem(itemId: string, note: string): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot do that." };

  const item = await prisma.clearanceItem.findUnique({
    where: { id: itemId },
    include: { exit: { include: { employee: true } } },
  });
  if (!item) return { error: "Not found." };
  if (item.exit.completedAt) return { error: "This exit is already finished." };

  const actorName = context.employee?.fullName ?? context.user.email;

  await prisma.$transaction(async (tx) => {
    await tx.clearanceItem.update({
      where: { id: itemId },
      data: {
        clearedById: item.clearedAt ? null : context.user.id,
        clearedByName: item.clearedAt ? "" : actorName,
        clearedAt: item.clearedAt ? null : new Date(),
        note: note.trim().slice(0, 300),
      },
    });
    await record({
      action: "exit.clearance_cleared",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: item.exit.employeeId,
      targetLabel: item.exit.employee.fullName,
      detail: { item: item.label, cleared: !item.clearedAt },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath(`/hr/exits/${item.exit.employeeId}`);
  return { ok: true };
}

/**
 * Steps 3 to 6 — finish the exit (§6.6).
 *
 * Releases the certificate and marks the ID Left. Refuses outright while a
 * terminal is still assigned: a person who has left holding a live trading
 * terminal is exactly what a BSEC inspection asks about, and a warning that
 * can be clicked past is not a safeguard.
 */
export async function completeExit(employeeId: string): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot do that." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      exit: { include: { clearanceItems: true } },
      terminalAssignments: { where: { releasedOn: null }, include: { terminal: true } },
      certificates: { where: { status: "ACTIVE" } },
    },
  });
  if (!employee?.exit) return { error: "No exit is recorded for this person." };
  if (employee.exit.completedAt) return { error: "This exit is already finished." };

  const blockers = exitBlockers({
    openTerminals: employee.terminalAssignments.length,
    unclearedItems: employee.exit.clearanceItems.filter((i) => !i.clearedAt).length,
  });
  if (blockers.length) return { error: blockers.join(" ") };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    // The certificate is surrendered, so they drop out of the expiry register.
    for (const certificate of employee.certificates) {
      await tx.rmCertificate.update({
        where: { id: certificate.id },
        data: { status: "SURRENDERED", surrenderedOn: employee.exit!.lastWorkingDay },
      });
    }

    await tx.employee.update({
      where: { id: employeeId },
      // Marked LEFT, never deleted. This is what makes the active-versus-left
      // headcount answerable at any moment in time (§6.6).
      data: { status: "LEFT" },
    });

    // Access closes at the end of the last working day. If that day has
    // already passed, it closes now rather than waiting for a nightly job.
    const closesAt = employee.exit!.lastWorkingDay;
    if (closesAt <= new Date()) {
      await tx.user.update({ where: { id: employee.userId }, data: { disabledAt: new Date() } });
      await tx.session.updateMany({
        where: { userId: employee.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await tx.exit.update({
      where: { employeeId },
      data: {
        completedAt: new Date(),
        completedById: context.user.id,
        completedByName: actorName,
      },
    });

    const actor = actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role });
    await record({
      action: "exit.completed",
      actor,
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: {
        lastWorkingDay: employee.exit!.lastWorkingDay.toISOString().slice(0, 10),
        certificatesSurrendered: employee.certificates.length,
        accessClosed: closesAt <= new Date(),
      },
      ip,
      tx,
    });
    await record({
      action: "employee.marked_left",
      actor,
      targetType: "employee",
      targetId: employeeId,
      targetLabel: `${employee.fullName} — ${employee.employeeId ?? "no ID"}`,
      detail: { lastWorkingDay: employee.exit!.lastWorkingDay.toISOString().slice(0, 10) },
      ip,
      tx,
    });
  });

  revalidatePath("/hr/exits");
  revalidatePath(`/hr/exits/${employeeId}`);
  revalidatePath("/hr/employees");
  return { ok: true };
}
