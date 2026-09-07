import type { Role } from "@prisma/client";
import { prisma } from "./db";
import { actorFrom, record } from "./audit";
import { notify } from "./notifications";

/**
 * Turning accounts on and off (§5.5, P5.2).
 *
 * Taking an explicit actor rather than reading a session, for the third time
 * in this codebase and for the same reason: the rules below are the whole of
 * the feature, and a test that cannot call them ends up asserting its own
 * re-staging of them instead. `lib/leave-decide.ts` and `lib/import-commit.ts`
 * are the other two.
 *
 * Nothing here deletes. §12: a disabled account keeps its employee record, its
 * documents and its history — "a brokerage that cannot produce a former
 * employee's file when asked has a real problem."
 */

export type Actor = { userId: string; role: Role; name: string };
export type AccountResult = { ok: true } | { error: string };

const MIN_REASON = 5;

export async function disableAccountAs(
  actor: Actor,
  userId: string,
  reason: string,
  ip = "",
): Promise<AccountResult> {
  const written = reason.trim().slice(0, 500);
  // §6 everywhere: anything a person is told, they are told the reason for.
  // This one is read months later by whoever asks why the account went.
  if (written.length < MIN_REASON) {
    return { error: "Say why. This is read long after you have forgotten." };
  }

  // Not a philosophical objection — the practical one. The Super Admin is the
  // last step on every leave application in the company, and an empty chair at
  // that desk stalls everybody.
  if (userId === actor.userId) {
    return { error: "You cannot disable your own account. Ask another Super Admin." };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { employee: { select: { fullName: true } } },
  });
  if (!user) return { error: "Not found." };
  if (user.disabledAt) return { error: "That account is already disabled." };

  if (user.role === "SUPER_ADMIN" && (await otherActiveSuperAdmins(userId)) === 0) {
    return { error: "That is the last Super Admin. Create another one before disabling this." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { disabledAt: new Date() } });
    // The sessions go in the same transaction. An account marked disabled
    // whose open tab keeps working for another hour is not disabled; it is
    // disabled-looking, which is worse than not doing it, because somebody has
    // already written "revoked" in a report.
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await record({
      action: "account.disabled",
      actor: actorFrom({ id: actor.userId, fullName: actor.name, role: actor.role }),
      targetType: "user",
      targetId: userId,
      targetLabel: `${user.employee?.fullName ?? user.email} <${user.email}>`,
      detail: { reason: written, role: user.role },
      ip,
      tx,
    });
  });

  return { ok: true };
}

export async function enableAccountAs(
  actor: Actor,
  userId: string,
  reason: string,
  ip = "",
): Promise<AccountResult> {
  const written = reason.trim().slice(0, 500);
  if (written.length < MIN_REASON) return { error: "Say why the account is coming back." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { employee: { select: { fullName: true, status: true } } },
  });
  if (!user) return { error: "Not found." };
  if (!user.disabledAt) return { error: "That account is already active." };

  // Their access closed at the end of their last working day and their file is
  // on the purge clock. Re-opening it needs the exit reversed first, so that
  // the record and the access agree with each other.
  if (user.employee?.status === "LEFT") {
    return { error: "That person is marked as having left. Reverse the exit first." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { disabledAt: null } });
    await record({
      action: "account.enabled",
      actor: actorFrom({ id: actor.userId, fullName: actor.name, role: actor.role }),
      targetType: "user",
      targetId: userId,
      targetLabel: `${user.employee?.fullName ?? user.email} <${user.email}>`,
      detail: { reason: written, role: user.role },
      ip,
      tx,
    });
    await notify(
      { userId, title: "Your account has been re-enabled", body: "You can sign in again.", link: "/" },
      tx,
    );
  });

  return { ok: true };
}

/**
 * Change what somebody is.
 *
 * A promotion to Branch Manager is an `EmployeeAssignment`; this is the
 * different question of what the software lets them do. The two are recorded
 * separately on purpose — a designation is a job title and a role is a set of
 * powers, and conflating them is how somebody keeps HR access after moving to
 * Trading.
 */
export async function changeRoleAs(
  actor: Actor,
  userId: string,
  role: Role,
  reason: string,
  ip = "",
): Promise<AccountResult> {
  const written = reason.trim().slice(0, 500);
  if (written.length < MIN_REASON) return { error: "Say why their access is changing." };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { employee: { select: { fullName: true } } },
  });
  if (!user) return { error: "Not found." };
  if (user.role === role) return { error: "They already have that role." };

  // Stepping down after handing over is legitimate; being the last one and
  // stepping down is not, and that holds whether it is somebody else's role
  // being changed or your own.
  if (user.role === "SUPER_ADMIN" && (await otherActiveSuperAdmins(userId)) === 0) {
    return { error: "That is the last Super Admin. Appoint another one first." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role } });
    // The role is read from the database on every request, so an open session
    // would pick the new one up by itself. The sessions go anyway: a person
    // whose powers just changed should be looking at a menu built for what
    // they are now, from a page loaded after the change rather than before.
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await record({
      action: "account.role_changed",
      actor: actorFrom({ id: actor.userId, fullName: actor.name, role: actor.role }),
      targetType: "user",
      targetId: userId,
      targetLabel: `${user.employee?.fullName ?? user.email} <${user.email}>`,
      detail: { from: user.role, to: role, reason: written },
      ip,
      tx,
    });
    await notify(
      { userId, title: "Your access has changed", body: "Sign in again to see it.", link: "/" },
      tx,
    );
  });

  return { ok: true };
}

function otherActiveSuperAdmins(excludingUserId: string): Promise<number> {
  return prisma.user.count({
    where: { role: "SUPER_ADMIN", disabledAt: null, id: { not: excludingUserId } },
  });
}
