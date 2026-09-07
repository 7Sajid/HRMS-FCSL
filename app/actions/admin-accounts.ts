"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { currentIp, getSessionContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { changeRoleAs, disableAccountAs, enableAccountAs, type AccountResult } from "@/lib/accounts";

/**
 * §5.5 — "the ability to create and deactivate accounts of any kind."
 *
 * Creating one is `app/actions/hr-accounts.ts`, shared with the HR Executive
 * and already refusing to let anybody below the Super Admin create an HR Head.
 * What lives here is the part that is the Super Admin's alone.
 *
 * Thin on purpose, like every other action file: resolve the session, check
 * the capability, hand it to the library, revalidate. The rules are in
 * `lib/accounts.ts` where a test can call exactly what these call.
 */

export type { AccountResult };

type Guard = { ok: true; actor: { userId: string; role: Role; name: string } } | { ok: false; error: string };

async function requireSuperAdmin(): Promise<Guard> {
  const context = await getSessionContext();
  if (!context) return { ok: false, error: "Please sign in again." };
  if (!can(context.viewer, "accounts.manage")) {
    return { ok: false, error: "Only the Super Admin manages accounts." };
  }
  return {
    ok: true,
    actor: {
      userId: context.user.id,
      role: context.user.role,
      name: context.employee?.fullName ?? context.user.email,
    },
  };
}

export async function disableAccount(userId: string, reason: string): Promise<AccountResult> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return { error: guard.error };

  const result = await disableAccountAs(guard.actor, userId, reason, await currentIp());
  if ("error" in result) return result;

  revalidatePath("/admin/accounts");
  return { ok: true };
}

export async function enableAccount(userId: string, reason: string): Promise<AccountResult> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return { error: guard.error };

  const result = await enableAccountAs(guard.actor, userId, reason, await currentIp());
  if ("error" in result) return result;

  revalidatePath("/admin/accounts");
  return { ok: true };
}

export async function changeRole(userId: string, role: Role, reason: string): Promise<AccountResult> {
  const guard = await requireSuperAdmin();
  if (!guard.ok) return { error: guard.error };

  const result = await changeRoleAs(guard.actor, userId, role, reason, await currentIp());
  if ("error" in result) return result;

  revalidatePath("/admin/accounts");
  return { ok: true };
}
