"use server";

import { revalidatePath } from "next/cache";
import type { AttendanceMark } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { calendarDate, formatMonth, fromISODate } from "@/lib/dates";
import { isLockedMark } from "@/lib/attendance";

export type SheetResult = { ok: true } | { error: string };

/**
 * Save one cell of the branch grid.
 *
 * Saves as the manager goes rather than all at once at the end — §6.3 allows
 * either, and a month's work lost to a closed tab is not a trade worth making.
 */
export async function markAttendance(
  branchId: string,
  year: number,
  month: number,
  employeeId: string,
  isoDate: string,
  mark: AttendanceMark,
): Promise<SheetResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "attendance.submit")) return { error: "Only a manager submits this." };

  const date = fromISODate(isoDate);
  if (!date) return { error: "Bad date." };

  // §6.3: approved leave, weekly offs and holidays "cannot be contradicted".
  // The screen does not offer these; this is what stops anybody who does not
  // use the screen.
  if (isLockedMark(mark)) {
    return { error: "That mark is set by the system and cannot be typed in." };
  }

  const sheet = await prisma.attendanceSheet.findUnique({
    where: { branchId_year_month: { branchId, year, month } },
  });
  if (sheet && sheet.status !== "OPEN") {
    return { error: "This sheet has been submitted. Only HR can change it now." };
  }

  // The date has to be in the month this sheet is for. `branchId`, `year`,
  // `month` and `isoDate` arrive as four independent values, so without this a
  // day in March can be written into the February sheet — and, because the
  // sheet is created on demand, a nonsense month can be created outright.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month) {
    return { error: "That date is not in the month this sheet covers." };
  }

  // The manager must own this branch. Being a manager is not the same as being
  // a manager of THIS branch.
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch || branch.branchManagerId !== context.employeeId) {
    return { error: "This is not your branch." };
  }

  // And owning the branch is not the same as this person being IN it. The
  // check above proves who the manager is; this one proves whose attendance
  // they are writing. Asked in the query rather than compared after the read,
  // and deliberately the same question the grid asks when it draws the rows —
  // anybody the sheet does not show is somebody the sheet cannot record.
  const onThisSheet = await prisma.employee.findFirst({
    where: {
      id: employeeId,
      branchId,
      onboardingStatus: "APPROVED",
      OR: [{ status: "ACTIVE" }, { lastWorkingDay: { gte: calendarDate(year, month, 1) } }],
    },
    select: { id: true },
  });
  if (!onThisSheet) return { error: "That person is not on this branch's sheet." };

  const open =
    sheet ??
    (await prisma.attendanceSheet.create({ data: { branchId, year, month, status: "OPEN" } }));

  await prisma.attendanceEntry.upsert({
    where: { sheetId_employeeId_date: { sheetId: open.id, employeeId, date } },
    create: { sheetId: open.id, employeeId, date, mark },
    update: { mark },
  });

  revalidatePath("/team/attendance");
  return { ok: true };
}

/**
 * Submit the month (§6.3).
 *
 * "On Submit the sheet locks and goes to HR." An attendance record that can be
 * changed quietly afterwards is worth nothing in a dispute — so after this
 * only HR can change it, only with a reason, and the change stays visible for
 * ever beside the original entry.
 */
export async function submitSheet(branchId: string, year: number, month: number): Promise<SheetResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "attendance.submit")) return { error: "Only a manager submits this." };

  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch || branch.branchManagerId !== context.employeeId) {
    return { error: "This is not your branch." };
  }

  const sheet = await prisma.attendanceSheet.findUnique({
    where: { branchId_year_month: { branchId, year, month } },
    include: { entries: true },
  });
  if (!sheet) return { error: "There is nothing filled in yet." };
  if (sheet.status !== "OPEN") return { error: "This has already been submitted." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.attendanceSheet.update({
      where: { id: sheet.id },
      data: {
        status: "SUBMITTED",
        submittedById: context.user.id,
        submittedByName: actorName,
        submittedAt: new Date(),
      },
    });

    await record({
      action: "attendance.sheet_submitted",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "attendanceSheet",
      targetId: sheet.id,
      targetLabel: `${branch.name} — ${formatMonth(year, month)}`,
      detail: { entries: sheet.entries.length },
      ip,
      tx,
    });

    const hr = await tx.user.findMany({
      where: { role: { in: ["HR_EXECUTIVE", "HR_HEAD"] }, disabledAt: null },
      select: { id: true },
    });
    await notify(
      hr.map((u) => ({
        userId: u.id,
        title: `${branch.name} submitted ${formatMonth(year, month)} attendance`,
        body: `${sheet.entries.length} entries from ${actorName}.`,
        link: "/hr/attendance",
      })),
      tx,
    );
  });

  revalidatePath("/team/attendance");
  revalidatePath("/hr/attendance");
  return { ok: true };
}

export { calendarDate };
