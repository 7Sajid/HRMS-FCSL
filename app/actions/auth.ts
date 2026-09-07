"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { actorFrom, record, recordQuietly } from "@/lib/audit";
import { createSession, destroySession, getSessionContext } from "@/lib/auth";
import { homePathFor } from "@/lib/permissions";
import { validatePassword } from "@/lib/passwords";
import { accessClosed } from "@/lib/exit";
import { todayInDhaka } from "@/lib/dates";
import { callerAddress, clearFailures, isRateLimited, recordFailure } from "@/lib/rate-limit";

/**
 * Every export in this file is a callable HTTP endpoint. There are no helpers
 * here for that reason.
 */

export type ActionResult = { ok: true; redirectTo?: string } | { error: string; field?: string };

/**
 * One sentence for every failure, whatever the cause.
 *
 * Wrong password, unknown email, disabled account and expired temporary
 * password all say the same thing. Telling somebody "no such account" confirms
 * which addresses exist, and for a company of four hundred people whose email
 * pattern is guessable that is a list of every employee. The distinction goes
 * to the audit log, where the people entitled to it can read it.
 */
const REFUSAL = "Incorrect email or password.";

export async function signIn(_previous: unknown, formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Enter your email and password." };

  const ip = callerAddress(await headers());

  // Checked before the user is looked up and before bcrypt runs, so a flood of
  // guesses costs an index scan rather than a hash comparison each.
  if (await isRateLimited(ip)) {
    return { error: "Too many attempts. Please wait fifteen minutes and try again." };
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { employee: true } });

  const refuse = async (reason: string) => {
    await recordFailure(ip);
    await recordQuietly({
      action: "auth.sign_in_failed",
      actor: user ? actorFrom({ ...user, fullName: user.employee?.fullName ?? user.email }) : null,
      targetType: "user",
      targetId: user?.id,
      targetLabel: email,
      detail: { reason },
      ip,
    });
    return { error: REFUSAL };
  };

  if (!user) {
    // Still hash something, so a missing account does not answer noticeably
    // faster than a wrong password.
    await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi");
    return refuse("no such account");
  }

  if (user.disabledAt) return refuse("account disabled");

  // The same sentence as every other refusal. Whether an account is closed
  // because the person left is not something to tell whoever is typing.
  if (accessClosed(user.employee, todayInDhaka())) return refuse("employment ended");

  if (user.tempPasswordExpiresAt && user.tempPasswordExpiresAt < new Date()) {
    // §4: an unused temporary password that stays valid for months is a way
    // into the system that nobody is watching. HR issues a fresh one.
    return refuse("temporary password expired");
  }

  if (!(await bcrypt.compare(password, user.passwordHash))) return refuse("wrong password");

  await clearFailures(ip);
  await createSession(user.id);

  await recordQuietly({
    action: "auth.signed_in",
    actor: actorFrom({ ...user, fullName: user.employee?.fullName ?? user.email }),
    targetType: "user",
    targetId: user.id,
    targetLabel: user.email,
    ip,
  });

  if (user.mustChangePassword) return { ok: true, redirectTo: "/set-password" };
  return { ok: true, redirectTo: homePathFor({ id: user.id, role: user.role }) };
}

export async function signOut(): Promise<void> {
  const context = await getSessionContext();
  if (context) {
    await recordQuietly({
      action: "auth.signed_out",
      actor: actorFrom({
        ...context.user,
        fullName: context.employee?.fullName ?? context.user.email,
      }),
      targetType: "user",
      targetId: context.user.id,
      targetLabel: context.user.email,
    });
  }
  await destroySession();
  redirect("/signin");
}

/**
 * The first thing the system asks for after the first login is a new password
 * of the person's own choosing (§4 step 2).
 */
export async function setPassword(_previous: unknown, formData: FormData): Promise<ActionResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Your session has ended. Please sign in again." };

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password !== confirm) return { error: "The two passwords do not match.", field: "confirm" };

  const problem = validatePassword(password, context.user.role);
  if (problem) return { error: problem, field: "password" };

  const current = await prisma.user.findUnique({ where: { id: context.user.id } });
  if (current && (await bcrypt.compare(password, current.passwordHash))) {
    return {
      error: "Please choose a password different from the one HR gave you.",
      field: "password",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: context.user.id },
      data: {
        passwordHash: await bcrypt.hash(password, 10),
        mustChangePassword: false,
        tempPasswordExpiresAt: null,
      },
    });
    await record({
      action: "auth.password_changed",
      actor: actorFrom({
        ...context.user,
        fullName: context.employee?.fullName ?? context.user.email,
      }),
      targetType: "user",
      targetId: context.user.id,
      targetLabel: context.user.email,
      tx,
    });
  });

  // Stage 1 accounts go to the upload screen; everyone else to their panel.
  if (context.employee && context.employee.onboardingStatus !== "APPROVED") {
    return { ok: true, redirectTo: "/onboarding" };
  }
  return { ok: true, redirectTo: homePathFor(context.viewer) };
}
