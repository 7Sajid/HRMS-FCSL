"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, changedFields, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { allocateEmployeeId, employeeIdIsTaken, parseEmployeeId } from "@/lib/employee-id";
import { loadOnboardingState } from "@/lib/onboarding";
import { ensureEntitlements } from "@/lib/leave-service";
import { fromISODate, todayInDhaka } from "@/lib/dates";
import { escapeHtml, layout, sendMail } from "@/lib/email";

export type ReviewResult = { ok: true; employeeId?: string } | { error: string };

/** Accept or reject one document, as HR works down the checklist (§4 step 5). */
export async function reviewDocument(
  documentId: string,
  accept: boolean,
  reason: string,
): Promise<ReviewResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "documents.approve")) return { error: "You cannot check documents." };

  const document = await prisma.employeeDocument.findUnique({
    where: { id: documentId },
    include: { employee: true },
  });
  if (!document) return { error: "Not found." };

  const written = reason.trim().slice(0, 500);
  // The reason is what reopens the box on the joiner's screen and tells them
  // what to do — "NID back side is blurred, please re-scan". Without one they
  // see a red box and no instruction.
  if (!accept && written.length < 5) {
    return { error: "Say what is wrong with it. They see exactly what you write." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.employeeDocument.update({
      where: { id: documentId },
      data: {
        status: accept ? "ACCEPTED" : "REJECTED",
        rejectionReason: accept ? "" : written,
        reviewedById: context.user.id,
        reviewedByName: actorName,
        reviewedAt: new Date(),
      },
    });

    // The photograph becomes the profile picture the moment it is accepted
    // (§4) — cached on the employee so a list of four hundred people does not
    // need four hundred extra queries.
    if (accept && document.kind === "PHOTOGRAPH") {
      await tx.employee.update({
        where: { id: document.employeeId },
        data: { photoKey: document.storageKey },
      });
    }

    await record({
      action: accept ? "document.accepted" : "document.rejected",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: document.employeeId,
      targetLabel: document.employee.fullName,
      detail: { kind: document.kind, fileName: document.originalName, reason: written || undefined },
      ip,
      tx,
    });
  });

  revalidatePath(`/hr/joiners/${document.employeeId}`);
  return { ok: true };
}

const detailsSchema = z.object({
  fullName: z.string().trim().min(2, "A name is needed.").max(120),
  fatherName: z.string().trim().max(120).optional().default(""),
  motherName: z.string().trim().max(120).optional().default(""),
  dateOfBirth: z.string().trim().optional().default(""),
  gender: z.string().trim().max(30).optional().default(""),
  nationality: z.string().trim().max(60).optional().default(""),
  religion: z.string().trim().max(60).optional().default(""),
  maritalStatus: z.string().trim().max(30).optional().default(""),
  nidNumber: z.string().trim().max(30).optional().default(""),
  mobile: z.string().trim().max(20).optional().default(""),
  personalEmail: z.string().trim().max(120).optional().default(""),
  presentAddress: z.string().trim().max(300).optional().default(""),
  permanentAddress: z.string().trim().max(300).optional().default(""),
});

/**
 * HR types the identity fields from the scan (§4 step 4).
 *
 * Reading them with AI is deferred, so there is nothing to confirm yet — but
 * every change is recorded with its old and new value, which is what §6 asks
 * for whether a machine or a person put it there.
 */
export async function saveEmployeeDetails(
  employeeId: string,
  _previous: unknown,
  formData: FormData,
): Promise<ReviewResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "employees.setup")) return { error: "You cannot edit staff records." };

  const parsed = detailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const before = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!before) return { error: "Not found." };

  const data = {
    ...parsed.data,
    dateOfBirth: fromISODate(parsed.data.dateOfBirth),
  };
  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: employeeId }, data });
    await record({
      action: "employee.updated",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: before.fullName,
      detail: changedFields(before as unknown as Record<string, unknown>, data),
      ip,
      tx,
    });
  });

  revalidatePath(`/hr/joiners/${employeeId}`);
  revalidatePath(`/hr/employees/${employeeId}`);
  return { ok: true };
}

/**
 * Send the file back (§4 step 5).
 *
 * "HR marks the specific documents that are wrong and writes a reason. Only
 * those boxes reopen. Everything already accepted stays accepted, so nothing
 * is uploaded twice."
 */
export async function sendBack(employeeId: string, note: string): Promise<ReviewResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "documents.approve")) return { error: "You cannot check documents." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true, documents: { where: { status: "REJECTED", supersededAt: null } } },
  });
  if (!employee) return { error: "Not found." };
  if (!employee.documents.length) {
    return { error: "Mark at least one document as wrong first — otherwise they cannot tell what to fix." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();
  const written = note.trim().slice(0, 500);

  await prisma.$transaction(async (tx) => {
    await tx.employee.update({
      where: { id: employeeId },
      data: { onboardingStatus: "SENT_BACK", sendBackReason: written },
    });
    await record({
      action: "documents.sent_back",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: { note: written, documents: employee.documents.map((d) => d.kind) },
      ip,
      tx,
    });
    await notify(
      {
        userId: employee.userId,
        title: "HR has sent your file back",
        body: written || "Some documents need re-doing.",
        link: "/onboarding",
      },
      tx,
    );
  });

  await sendMail({
    to: employee.user.email,
    subject: "Your documents need a second look",
    html: layout({
      heading: "HR has sent your file back",
      lines: [
        written ? escapeHtml(written) : "Some documents need re-doing.",
        "Only the items marked in red need attention — everything already accepted stays accepted.",
      ],
      link: { label: "Open my upload screen", href: "/onboarding" },
    }),
  });

  revalidatePath(`/hr/joiners/${employeeId}`);
  revalidatePath("/hr/joiners");
  return { ok: true };
}

const approveSchema = z.object({
  employeeIdOverride: z.string().trim().optional().default(""),
  branchId: z.string().trim().optional().default(""),
  departmentId: z.string().trim().optional().default(""),
  designationId: z.string().trim().optional().default(""),
  gradeId: z.string().trim().optional().default(""),
  managerId: z.string().trim().optional().default(""),
  joiningDate: z.string().trim().min(1, "Set the joining date — it decides their employee ID."),
});

/**
 * Approve (§4 step 5).
 *
 * "HR assigns the employee ID, sets the category, sets the branch, sets who
 * the person reports to, and presses Approve. The full panel opens the moment
 * the person next refreshes their screen."
 */
export async function approveJoiner(
  employeeId: string,
  _previous: unknown,
  formData: FormData,
): Promise<ReviewResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "documents.approve")) return { error: "You cannot approve documents." };

  const parsed = approveSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true, documents: { where: { supersededAt: null } } },
  });
  if (!employee) return { error: "Not found." };
  if (employee.onboardingStatus === "APPROVED") return { error: "This file is already approved." };

  // §3: the HR Head's own documents go to the Super Admin. An HR Executive
  // cannot open the door for the person who checks their work.
  if (
    (employee.user.role === "HR_HEAD" || employee.user.role === "SUPER_ADMIN") &&
    !can(context.viewer, "accounts.manage")
  ) {
    return { error: "Only the Super Admin approves an HR Head's documents." };
  }

  const state = await loadOnboardingState(employee);
  if (!state.progress.complete) {
    return { error: `Their file is not complete: ${state.missing.join(", ")}.` };
  }
  const stillPending = employee.documents.filter((d) => d.status === "PENDING");
  if (stillPending.length) {
    return {
      error: `Accept or reject every document first — ${stillPending.length} still unchecked.`,
    };
  }
  if (employee.documents.some((d) => d.status === "REJECTED")) {
    return { error: "Some documents are marked wrong. Send the file back instead." };
  }

  const joiningDate = fromISODate(parsed.data.joiningDate);
  if (!joiningDate) return { error: "The joining date is not a date." };

  const override = parsed.data.employeeIdOverride;
  if (override) {
    if (!parseEmployeeId(override)) {
      return { error: `"${override}" is not a valid employee ID. The format is A 413 - 26 - 70.` };
    }
    if (await employeeIdIsTaken(override)) {
      return { error: `${override} has already been issued. An ID is never reused.` };
    }
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  const issued = await prisma.$transaction(async (tx) => {
    let employeeIdValue = override;
    let parts = override ? parseEmployeeId(override)! : null;
    if (!employeeIdValue) {
      const allocated = await allocateEmployeeId(tx, joiningDate.getUTCFullYear());
      employeeIdValue = allocated.employeeId;
      parts = allocated.parts;
    }

    const assignment = {
      branchId: parsed.data.branchId || null,
      departmentId: parsed.data.departmentId || null,
      designationId: parsed.data.designationId || null,
      gradeId: parsed.data.gradeId || null,
      managerId: parsed.data.managerId || null,
    };

    await tx.employee.update({
      where: { id: employeeId },
      data: {
        ...assignment,
        employeeId: employeeIdValue,
        idLetter: parts!.letter,
        idNumber: parts!.number,
        idYear: parts!.year,
        joiningDate,
        onboardingStatus: "APPROVED",
        approvedAt: new Date(),
        approvedById: context.user.id,
        approvedByName: actorName,
        sendBackReason: "",
      },
    });

    // The dated history starts here. A transfer later writes another row; this
    // one is never overwritten (§6.1).
    await tx.employeeAssignment.create({
      data: {
        employeeId,
        effectiveFrom: joiningDate,
        ...assignment,
        reason: "JOINING",
        recordedById: context.user.id,
        recordedByName: actorName,
      },
    });

    // An RM's certificate goes straight onto the register, with the dates that
    // were captured with the file. That register is what the four-month
    // warning reads.
    const certificate = employee.documents.find(
      (d) => d.kind === "RM_CERTIFICATE" && d.status === "ACCEPTED" && d.expiryDate,
    );
    if (certificate?.issueDate && certificate.expiryDate) {
      await tx.rmCertificate.create({
        data: {
          employeeId,
          certificateNumber: certificate.label || "—",
          issueDate: certificate.issueDate,
          expiryDate: certificate.expiryDate,
          documentId: certificate.id,
          status: "ACTIVE",
          recordedById: context.user.id,
          recordedByName: actorName,
        },
      });
      await record({
        action: "certificate.recorded",
        actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
        targetType: "employee",
        targetId: employeeId,
        targetLabel: employee.fullName,
        detail: { expiryDate: certificate.expiryDate.toISOString().slice(0, 10) },
        ip,
        tx,
      });
    }

    const actor = actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role });
    await record({
      action: "employee.id_issued",
      actor,
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: { employeeId: employeeIdValue, overridden: Boolean(override) },
      ip,
      tx,
    });
    await record({
      action: "documents.approved",
      actor,
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: { employeeId: employeeIdValue, documents: employee.documents.length },
      ip,
      tx,
    });

    await notify(
      {
        userId: employee.userId,
        title: "Your documents are approved",
        body: `Your employee ID is ${employeeIdValue}. Your panel is open.`,
        link: "/me/profile",
      },
      tx,
    );

    return employeeIdValue;
  });

  // Entitlement for the year they joined, so leave works from day one.
  const approved = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (approved) await ensureEntitlements(approved, todayInDhaka().getUTCFullYear());

  await sendMail({
    to: employee.user.email,
    subject: "Your FCSL HR account is open",
    html: layout({
      heading: "Your documents are approved",
      lines: [
        `Your employee ID is <strong>${escapeHtml(issued)}</strong>.`,
        "Your full panel is open — you can apply for leave from today.",
      ],
      link: { label: "Open my panel", href: "/me/profile" },
    }),
  });

  revalidatePath("/hr/joiners");
  revalidatePath(`/hr/joiners/${employeeId}`);
  return { ok: true, employeeId: issued };
}
