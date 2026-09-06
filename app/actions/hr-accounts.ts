"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Role, StaffType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { forDictation, generatePassword } from "@/lib/passwords";

export type CreateResult =
  | { ok: true; password: string; dictation: string; expiresAt: string; name: string }
  | { error: string; field?: string };

const schema = z.object({
  fullName: z.string().trim().min(2, "Enter their full name.").max(120),
  email: z.string().trim().toLowerCase().email("That is not an email address."),
  mobile: z
    .string()
    .trim()
    .regex(/^01[3-9]\d{8}$/, "Enter an 11-digit Bangladeshi mobile number, like 01712345678."),
  role: z.enum(["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"]),
  staffType: z.enum(["STAFF", "RM"]),
});

/**
 * §4 step 1 — "an account using three pieces of information only: name, email
 * address and mobile number. Nothing else is needed yet."
 *
 * HR does not type the employee's personal details, does not create the
 * employee ID and does not choose the branch. None of that happens until the
 * documents arrive and are checked, when the evidence is in front of the
 * person deciding.
 */
export async function createAccount(_previous: unknown, formData: FormData): Promise<CreateResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "accounts.create")) return { error: "You cannot create accounts." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { error: issue.message, field: String(issue.path[0] ?? "") };
  }
  const { fullName, email, mobile, role, staffType } = parsed.data;

  // Only the Super Admin creates accounts of ANY kind (§5.5). An HR Executive
  // creating an HR Head would be creating the person who checks their work.
  if (!can(context.viewer, "accounts.manage") && (role === "HR_HEAD" || role === "SUPER_ADMIN")) {
    return { error: "Only the Super Admin can create an HR Head or another Super Admin.", field: "role" };
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    return { error: "There is already an account with that email.", field: "email" };
  }

  // §4 step 2: the password is handed over by a person, never emailed, and it
  // expires in seven days. An unused temporary password that stays valid for
  // months is a way into the system nobody is watching.
  const password = generatePassword(16);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role: role as Role,
        mustChangePassword: true,
        tempPasswordExpiresAt: expiresAt,
        createdById: context.user.id,
        createdByName: actorName,
      },
    });

    await tx.employee.create({
      data: {
        userId: user.id,
        fullName,
        mobile,
        staffType: staffType as StaffType,
        onboardingStatus: "DRAFT",
      },
    });

    const actor = actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role });
    await record({
      action: "account.created",
      actor,
      targetType: "user",
      targetId: user.id,
      targetLabel: `${fullName} <${email}>`,
      detail: { role, staffType },
      ip,
      tx,
    });
    await record({
      action: "auth.temp_password_issued",
      actor,
      targetType: "user",
      targetId: user.id,
      targetLabel: email,
      // The password itself is never written to the log. Recording it would
      // make the permanent record a place worth stealing.
      detail: { expiresAt: expiresAt.toISOString() },
      ip,
      tx,
    });
  });

  revalidatePath("/hr/joiners");
  return {
    ok: true,
    password,
    dictation: forDictation(password),
    expiresAt: expiresAt.toDateString(),
    name: fullName,
  };
}

/** A joiner who never used their password needs a fresh one (§4). */
export async function reissuePassword(employeeId: string): Promise<CreateResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "accounts.create")) return { error: "You cannot do that." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true },
  });
  if (!employee) return { error: "Not found." };

  const password = generatePassword(16);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: employee.userId },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: true,
        tempPasswordExpiresAt: expiresAt,
      },
    });
    // Any session opened with the old password stops working. A reissue is
    // usually because somebody could not get in, but it is also what happens
    // when a password has gone astray.
    await tx.session.updateMany({
      where: { userId: employee.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await record({
      action: "auth.temp_password_issued",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "user",
      targetId: employee.userId,
      targetLabel: employee.user.email,
      detail: { reissued: true, expiresAt: expiresAt.toISOString() },
      ip,
      tx,
    });
  });

  revalidatePath("/hr/joiners");
  return {
    ok: true,
    password,
    dictation: forDictation(password),
    expiresAt: expiresAt.toDateString(),
    name: employee.fullName,
  };
}
