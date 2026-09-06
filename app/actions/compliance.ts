"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record, recordQuietly } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can, canReadShowCause } from "@/lib/permissions";
import { escapeHtml, layout, sendMail } from "@/lib/email";

export type ComplianceResult = { ok: true; id?: string } | { error: string };

const issueSchema = z.object({
  employeeId: z.string().trim().min(1, "Choose who this is about."),
  subject: z.string().trim().min(5, "Give it a subject.").max(200),
  body: z.string().trim().min(30, "The letter needs to say what happened and what is required."),
  visibleToManager: z.string().optional(),
});

/** Step 1 — the HR Head writes the letter. */
export async function issueShowCause(_previous: unknown, formData: FormData): Promise<ComplianceResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "showcause.issue")) return { error: "Only the HR Head issues these." };

  const parsed = issueSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const employee = await prisma.employee.findUnique({
    where: { id: parsed.data.employeeId },
    include: { user: { select: { id: true, email: true } } },
  });
  if (!employee) return { error: "Not found." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  const created = await prisma.$transaction(async (tx) => {
    const showCause = await tx.showCause.create({
      data: {
        employeeId: employee.id,
        subject: parsed.data.subject,
        body: parsed.data.body,
        issuedById: context.user.id,
        issuedByName: actorName,
        // Off unless the HR Head deliberately turns it on.
        visibleToManager: parsed.data.visibleToManager === "yes",
      },
    });

    await record({
      action: "showcause.issued",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employee.id,
      targetLabel: employee.fullName,
      detail: { subject: parsed.data.subject, visibleToManager: showCause.visibleToManager },
      ip,
      tx,
    });

    // §8: the employee ONLY. Not their manager, not HR generally.
    await notify(
      {
        userId: employee.user.id,
        title: "You have received a show-cause letter",
        body: parsed.data.subject,
        link: `/me/compliance/${showCause.id}`,
      },
      tx,
    );

    return showCause;
  });

  // §6.5: timestamped delivery, which "protects the employee and the company
  // equally". The email says a letter exists and carries no detail.
  await sendMail({
    to: employee.user.email,
    subject: "A show-cause letter has been issued to you",
    html: layout({
      heading: "You have received a show-cause letter",
      lines: [
        escapeHtml(parsed.data.subject),
        "Sign in to read it in full and to write your reply. You have three working days.",
      ],
      link: { label: "Read it", href: `/me/compliance/${created.id}` },
    }),
  });

  revalidatePath("/hr/compliance");
  return { ok: true, id: created.id };
}

/** Step 3 — the employee replies, and the system makes the PDF. */
export async function replyToShowCause(
  showCauseId: string,
  _previous: unknown,
  formData: FormData,
): Promise<ComplianceResult> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };

  const body = String(formData.get("replyBody") ?? "").trim();
  if (body.length < 20) return { error: "Please write a fuller reply." };

  const showCause = await prisma.showCause.findUnique({ where: { id: showCauseId } });
  if (!showCause || showCause.employeeId !== context.employee.id) return { error: "Not found." };
  if (showCause.repliedAt) return { error: "You have already replied." };

  const ip = await currentIp();
  await prisma.$transaction(async (tx) => {
    await tx.showCause.update({
      where: { id: showCauseId },
      data: {
        replyBody: body.slice(0, 8000),
        repliedAt: new Date(),
        acknowledgedAt: showCause.acknowledgedAt ?? new Date(),
      },
    });
    await record({
      action: "showcause.replied",
      actor: actorFrom({ ...context.user, fullName: context.employee!.fullName }),
      targetType: "employee",
      targetId: context.employee!.id,
      targetLabel: context.employee!.fullName,
      detail: { subject: showCause.subject },
      ip,
      tx,
    });
    const heads = await tx.user.findMany({
      where: { role: "HR_HEAD", disabledAt: null },
      select: { id: true },
    });
    await notify(
      heads.map((u) => ({
        userId: u.id,
        title: `${context.employee!.fullName} replied to a show-cause`,
        body: showCause.subject,
        link: `/hr/compliance/${showCauseId}`,
      })),
      tx,
    );
  });

  revalidatePath(`/me/compliance/${showCauseId}`);
  revalidatePath(`/hr/compliance/${showCauseId}`);
  return { ok: true };
}

/** Step 4 — the HR Head records the outcome. */
export async function closeShowCause(
  showCauseId: string,
  outcome: "NO_ACTION" | "WARNING" | "ESCALATED",
  note: string,
): Promise<ComplianceResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "showcause.issue")) return { error: "Only the HR Head closes these." };

  const showCause = await prisma.showCause.findUnique({
    where: { id: showCauseId },
    include: { employee: { include: { user: { select: { id: true } } } } },
  });
  if (!showCause) return { error: "Not found." };
  if (showCause.closedAt) return { error: "This is already closed." };
  if (!showCause.repliedAt && outcome !== "NO_ACTION") {
    return { error: "They have not replied yet. Closing with no action is the only option until they do." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  await prisma.$transaction(async (tx) => {
    await tx.showCause.update({
      where: { id: showCauseId },
      data: {
        outcome,
        outcomeNote: note.trim().slice(0, 1000),
        closedById: context.user.id,
        closedByName: actorName,
        closedAt: new Date(),
      },
    });
    await record({
      action: "showcause.closed",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: showCause.employeeId,
      targetLabel: showCause.employee.fullName,
      detail: { subject: showCause.subject, outcome, note: note || undefined },
      ip: await currentIp(),
      tx,
    });
    await notify(
      {
        userId: showCause.employee.user.id,
        title: "Your show-cause has been closed",
        body: note || outcome.replace(/_/g, " ").toLowerCase(),
        link: `/me/compliance/${showCauseId}`,
      },
      tx,
    );
  });

  revalidatePath(`/hr/compliance/${showCauseId}`);
  revalidatePath("/hr/compliance");
  return { ok: true };
}

/**
 * Record that somebody opened a show-cause file.
 *
 * §6.5: "Every single time this record is opened, the system records who
 * opened it." Called from the page rather than left to a query, because a
 * read that leaves no trace is exactly what this section forbids.
 */
export async function noteShowCauseView(showCauseId: string): Promise<void> {
  const context = await getSessionContext();
  if (!context) return;

  const showCause = await prisma.showCause.findUnique({
    where: { id: showCauseId },
    include: { employee: { select: { id: true, fullName: true, managerId: true } } },
  });
  if (!showCause) return;

  const isTheirManager = showCause.employee.managerId === context.employeeId;
  if (!canReadShowCause(context.viewer, showCause, context.employeeId, isTheirManager)) return;

  await recordQuietly({
    action: "showcause.viewed",
    actor: actorFrom({
      ...context.user,
      fullName: context.employee?.fullName ?? context.user.email,
    }),
    targetType: "employee",
    targetId: showCause.employeeId,
    targetLabel: showCause.employee.fullName,
    detail: { subject: showCause.subject, showCauseId },
    ip: await currentIp(),
  });
}
