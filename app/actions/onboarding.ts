"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { loadOnboardingState } from "@/lib/onboarding";

export type Result = { ok: true } | { error: string };

const bankSchema = z.object({
  accountName: z.string().trim().min(2, "Enter the name on the account."),
  accountNumber: z
    .string()
    .trim()
    .min(6, "Enter the account number.")
    .max(34)
    .regex(/^[0-9\- ]+$/, "An account number is digits, spaces and hyphens only."),
  bankName: z.string().trim().min(2, "Enter the bank's name."),
  branchName: z.string().trim().min(2, "Enter the branch."),
  routingNumber: z
    .string()
    .trim()
    .max(20)
    .regex(/^[0-9]*$/, "A routing number is digits only.")
    .optional()
    .default(""),
});

export async function saveBankDetails(_previous: unknown, formData: FormData): Promise<Result> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };

  const parsed = bankSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the fields." };

  const employee = context.employee;
  const existing = await prisma.employeeBankDetail.findUnique({ where: { employeeId: employee.id } });
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.employeeBankDetail.upsert({
      where: { employeeId: employee.id },
      create: { employeeId: employee.id, ...parsed.data, updatedById: context.user.id, updatedByName: employee.fullName },
      update: { ...parsed.data, updatedById: context.user.id, updatedByName: employee.fullName },
    });
    await record({
      action: "bank.updated",
      actor: actorFrom({ ...context.user, fullName: employee.fullName }),
      targetType: "employee",
      targetId: employee.id,
      targetLabel: employee.fullName,
      // The account NUMBER is never written to the log. §6 asks for old and
      // new values on a change, but a permanent record of every bank account
      // anybody has ever held is a liability, not an audit trail. That it
      // changed, and who changed it, is the auditable fact.
      detail: { firstTime: !existing },
      ip,
      tx,
    });
  });

  revalidatePath("/onboarding");
  revalidatePath("/me/profile");
  return { ok: true };
}

const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter the contact's name."),
  relationship: z.string().trim().min(2, "How are they related to you?"),
  mobile: z
    .string()
    .trim()
    .regex(/^01[3-9]\d{8}$/, "Enter an 11-digit Bangladeshi mobile number, like 01712345678."),
  address: z.string().trim().max(300).optional().default(""),
});

export async function saveEmergencyContact(_previous: unknown, formData: FormData): Promise<Result> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };

  const slot = Number(formData.get("slot") ?? 1);
  if (slot !== 1 && slot !== 2) return { error: "Unknown contact." };

  const parsed = contactSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the fields." };

  const employee = context.employee;
  const ip = await currentIp();

  // Before the door opens the employee is filling their file in for the first
  // time, so this is a straight write. AFTER approval the same edit becomes a
  // proposal that HR approves (§5.1 page 3) — that path is P1.4.
  const beforeApproval = employee.onboardingStatus !== "APPROVED";

  await prisma.$transaction(async (tx) => {
    const current = await tx.emergencyContact.findFirst({
      where: { employeeId: employee.id, slot, status: { in: ["CURRENT", "PENDING"] } },
    });

    if (current) {
      await tx.emergencyContact.update({
        where: { id: current.id },
        data: { ...parsed.data, status: beforeApproval ? "CURRENT" : "PENDING" },
      });
    } else {
      await tx.emergencyContact.create({
        data: {
          employeeId: employee.id,
          slot,
          ...parsed.data,
          status: beforeApproval ? "CURRENT" : "PENDING",
          proposedById: context.user.id,
          proposedByName: employee.fullName,
        },
      });
    }

    await record({
      action: beforeApproval ? "contact.approved" : "contact.proposed",
      actor: actorFrom({ ...context.user, fullName: employee.fullName }),
      targetType: "employee",
      targetId: employee.id,
      targetLabel: employee.fullName,
      detail: { slot, duringOnboarding: beforeApproval },
      ip,
      tx,
    });
  });

  revalidatePath("/onboarding");
  revalidatePath("/me/emergency-contacts");
  return { ok: true };
}

/**
 * Press Submit and the file lands in HR's queue (§4 step 5).
 *
 * The button is grey until everything required is green, but the check runs
 * again here — the button is a courtesy and this is the rule. A form action is
 * a callable HTTP endpoint, and a disabled button stops nobody who does not
 * use the button.
 */
export async function submitForReview(): Promise<Result> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };
  const employee = context.employee;

  if (employee.onboardingStatus === "APPROVED") return { error: "Your file has already been approved." };
  if (employee.onboardingStatus === "SUBMITTED") return { error: "This is already with HR." };

  const state = await loadOnboardingState(employee);
  if (!state.canSubmit) {
    return { error: `Still missing: ${state.missing.join(", ")}.` };
  }

  const ip = await currentIp();
  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: employee.id },
      data: { onboardingStatus: "SUBMITTED", submittedAt: new Date(), sendBackReason: "" },
    });

    await record({
      action: "documents.submitted",
      actor: actorFrom({ ...context.user, fullName: employee.fullName }),
      targetType: "employee",
      targetId: employee.id,
      targetLabel: employee.fullName,
      detail: { documents: state.progress.total },
      ip,
      tx,
    });

    // §8: HR Executives and the HR Head are told immediately that somebody is
    // waiting. The queue is sorted by how long they have waited, so a person
    // sitting blocked is visible rather than merely recorded.
    const reviewers = await tx.user.findMany({
      where: { role: { in: ["HR_EXECUTIVE", "HR_HEAD"] }, disabledAt: null },
      select: { id: true },
    });
    await notify(
      reviewers.map((r) => ({
        userId: r.id,
        title: `${employee.fullName} is waiting for review`,
        body: "Their documents have been submitted.",
        link: `/hr/joiners`,
      })),
      tx,
    );
  });

  revalidatePath("/onboarding");
  return { ok: true };
}
