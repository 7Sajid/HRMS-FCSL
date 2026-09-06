"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";

export type Result = { ok: true } | { error: string };

/**
 * The "Request a correction" button on page 1 (§5.1).
 *
 * A note to HR, never a direct edit — a staff file that the person it
 * describes can edit is not a staff file.
 */
export async function requestCorrection(_previous: unknown, formData: FormData): Promise<Result> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };
  const employee = context.employee;

  const parsed = z
    .object({
      message: z
        .string()
        .trim()
        .min(5, "Please say what needs changing.")
        .max(1000, "Please keep it under a thousand characters."),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  // One open request at a time. Ten identical notes help nobody, and HR
  // answering the fifth one does not close the other four.
  const alreadyOpen = await prisma.correctionRequest.count({
    where: { employeeId: employee.id, status: "OPEN" },
  });
  if (alreadyOpen >= 3) {
    return { error: "You already have three requests with HR. They will come back to you." };
  }

  const ip = await currentIp();
  await prisma.$transaction(async (tx) => {
    await tx.correctionRequest.create({
      data: { employeeId: employee.id, message: parsed.data.message },
    });
    await record({
      action: "correction.requested",
      actor: actorFrom({ ...context.user, fullName: employee.fullName }),
      targetType: "employee",
      targetId: employee.id,
      targetLabel: employee.fullName,
      detail: { message: parsed.data.message },
      ip,
      tx,
    });
    const hr = await tx.user.findMany({
      where: { role: { in: ["HR_EXECUTIVE", "HR_HEAD"] }, disabledAt: null },
      select: { id: true },
    });
    await notify(
      hr.map((r) => ({
        userId: r.id,
        title: `${employee.fullName} asked for a correction`,
        body: parsed.data.message.slice(0, 140),
        link: `/hr/employees/${employee.id}`,
      })),
      tx,
    );
  });

  revalidatePath("/me/profile");
  return { ok: true };
}
