"use server";

import { revalidatePath } from "next/cache";
import type { AttendanceMark } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { formatMonth } from "@/lib/dates";

export type VerifyResult = { ok: true } | { error: string };

/**
 * §6.3 — "only HR can change it, only with a reason, and the change stays
 * visible for ever alongside the original entry. The manager can see what HR
 * changed and why."
 *
 * The correction is a row of its own rather than an edit, so the original mark
 * is still readable. An attendance record that can be changed quietly is worth
 * nothing in a dispute, and a correction with no trail is a quiet change with
 * extra steps.
 */
export async function correctEntry(
  entryId: string,
  newMark: AttendanceMark,
  reason: string,
): Promise<VerifyResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "attendance.verify")) return { error: "You cannot correct branch attendance." };

  const written = reason.trim().slice(0, 300);
  if (written.length < 5) {
    return { error: "Say why it is being changed. The manager sees exactly what you write." };
  }

  const entry = await prisma.attendanceEntry.findUnique({
    where: { id: entryId },
    include: { sheet: { include: { branch: true } }, employee: true },
  });
  if (!entry) return { error: "Not found." };
  if (entry.sheet.status === "OPEN") {
    return { error: "The branch has not submitted this month yet." };
  }
  if (entry.mark === newMark) return { error: "That is already what it says." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.attendanceCorrection.create({
      data: {
        entryId,
        previousMark: entry.mark,
        newMark,
        reason: written,
        correctedById: context.user.id,
        correctedByName: actorName,
      },
    });
    await tx.attendanceEntry.update({ where: { id: entryId }, data: { mark: newMark } });

    await record({
      action: "attendance.corrected",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: entry.employeeId,
      targetLabel: entry.employee.fullName,
      detail: {
        date: entry.date.toISOString().slice(0, 10),
        from: entry.mark,
        to: newMark,
        reason: written,
        branch: entry.sheet.branch.name,
      },
      ip,
      tx,
    });
  });

  revalidatePath(`/hr/attendance/${entry.sheetId}`);
  return { ok: true };
}

/**
 * Publish the month (§6.3).
 *
 * Until this happens the employee's own page reads "Not yet published" — which
 * is exactly what the specification asks for, and means nobody sees a
 * half-checked month and treats it as final.
 */
export async function publishSheet(sheetId: string): Promise<VerifyResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "attendance.verify")) return { error: "You cannot publish branch attendance." };

  const sheet = await prisma.attendanceSheet.findUnique({
    where: { id: sheetId },
    include: { branch: true, entries: { select: { employeeId: true } } },
  });
  if (!sheet) return { error: "Not found." };
  if (sheet.status === "OPEN") return { error: "The branch has not submitted this month yet." };
  if (sheet.status === "PUBLISHED") return { error: "This month is already published." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.attendanceSheet.update({
      where: { id: sheetId },
      data: {
        status: "PUBLISHED",
        publishedById: context.user.id,
        publishedByName: actorName,
        publishedAt: new Date(),
      },
    });

    await record({
      action: "attendance.published",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "attendanceSheet",
      targetId: sheetId,
      targetLabel: `${sheet.branch.name} — ${formatMonth(sheet.year, sheet.month)}`,
      detail: { entries: sheet.entries.length },
      ip,
      tx,
    });

    // §8: everybody in that branch is told on publication.
    const people = await tx.employee.findMany({
      where: { id: { in: [...new Set(sheet.entries.map((e) => e.employeeId))] } },
      select: { userId: true },
    });
    await notify(
      people.map((p) => ({
        userId: p.userId,
        title: `${formatMonth(sheet.year, sheet.month)} attendance is published`,
        body: "You can see your own month now.",
        link: "/me/leave",
      })),
      tx,
    );
  });

  revalidatePath("/hr/attendance");
  revalidatePath(`/hr/attendance/${sheetId}`);
  revalidatePath("/me/leave");
  return { ok: true };
}
