import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./db";
import { actorFrom, record } from "./audit";
import { notify } from "./notifications";
import { canDecideAt, chainAdvance } from "./approval-chain";
import { consumeEntitlement } from "./leave-service";
import { formatDate } from "./dates";
import { sendMail, layout, escapeHtml } from "./email";

/**
 * Decide one step of a leave application (§7.1).
 *
 * The whole of the rule lives here, taking an explicit actor rather than
 * reading a session, for two reasons: the same logic serves the manager's
 * page, the HR Head's inbox and the Super Admin's — three implementations of
 * a three-rule process is three places for the rules to drift — and a test can
 * call exactly what the screen calls rather than re-staging the outcome and
 * checking its own staging.
 *
 * The three rules, and where each is enforced:
 *
 *   1. One step at a time, in order — canDecideAt(). Nobody skips a step and
 *      nobody approves out of turn, whatever screen they came from.
 *   2. A denial stops the chain dead — nobody above the person who denied it
 *      is notified, because as far as the chain is concerned the request no
 *      longer exists.
 *   3. Final approval is the only moment leave is granted — the applicant and
 *      every approver along the way are told together, and only then does the
 *      entitlement get consumed.
 */

export type Decider = {
  userId: string;
  role: Role;
  /** Null for an account with no employee record behind it. */
  employeeId: string | null;
  name: string;
};

export type DecisionResult =
  | { ok: true; outcome: "denied" | "passed" | "granted" }
  | { error: string };

export async function applyLeaveDecision(
  actor: Decider,
  requestId: string,
  decision: "GRANT" | "DENY",
  reason: string,
  ip = "",
): Promise<DecisionResult> {
  const request = await prisma.leaveRequest.findUnique({
    where: { id: requestId },
    include: {
      leaveType: true,
      days: { orderBy: { date: "asc" } },
      approvals: { orderBy: { step: "asc" } },
      employee: { include: { user: { select: { id: true, email: true, role: true } } } },
    },
  });
  // Not "you may not decide this" — an application somebody has no part in is
  // not one whose existence they should be able to confirm.
  if (!request) return { error: "Not found." };
  if (request.status !== "PENDING") return { error: "This has already been decided." };

  const applicantRole = request.employee.user.role;
  const actorRole = actor.role;

  // Rule 1.
  if (!canDecideAt(applicantRole, request.currentStep, actorRole)) {
    return { error: "This is not waiting with you." };
  }

  // A manager step means THIS person's manager, not any manager in the
  // company. The role check above says "a manager decides here"; this says
  // "and it has to be yours".
  if (actorRole === "MANAGER" && request.employee.managerId !== actor.employeeId) {
    return { error: "This is not waiting with you." };
  }

  const written = reason.trim().slice(0, 1000);
  // §5.2: "A denial needs a written reason — the system will not accept an
  // empty one." A rejection with no reason is a phone call with extra steps.
  if (decision === "DENY" && written.length < 5) {
    return { error: "Please give a reason. The applicant sees exactly what you write here." };
  }

  const cost = request.days.reduce((total, d) => total + Number(d.lengthDays), 0);
  const first = request.days[0]?.date ?? null;
  const last = request.days.at(-1)?.date ?? null;
  const next = chainAdvance(applicantRole, request.currentStep);
  const actorName = actor.name;
  
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.leaveApproval.create({
      data: {
        leaveRequestId: request.id,
        step: request.currentStep,
        approverRole: actorRole,
        approverId: actor.userId,
        approverName: actorName,
        decision: decision === "GRANT" ? "GRANTED" : "DENIED",
        reason: written,
      },
    });

    if (decision === "DENY") {
      await tx.leaveRequest.update({
        where: { id: request.id },
        data: { status: "DENIED", currentApproverRole: null, decidedAt: new Date() },
      });

      // Rule 2. The applicant only.
      await notify(
        {
          userId: request.employee.user.id,
          title: `Your ${request.leaveType.name.toLowerCase()} was denied`,
          body: `${actorName}: ${written}`,
          link: "/me/leave",
        },
        tx,
      );

      await record({
        action: "leave.denied",
        actor: actorFrom({ id: actor.userId, fullName: actorName, role: actor.role }),
        targetType: "leaveRequest",
        targetId: request.id,
        targetLabel: `${request.employee.fullName} — ${request.leaveType.name}`,
        detail: { step: request.currentStep, reason: written, nobodyAboveNotified: true },
        ip,
        tx,
      });

      return { kind: "denied" as const, shortfall: 0 };
    }

    if (next.approver) {
      await tx.leaveRequest.update({
        where: { id: request.id },
        data: { currentStep: next.step, currentApproverRole: next.approver },
      });

      // Rule 1: only the next person is told, and only now.
      const approvers = await approversFor(tx, next.approver, request.employee.managerId);
      await notify(
        approvers.map((u) => ({
          userId: u.id,
          title: `${request.employee.fullName} — ${cost} day${cost === 1 ? "" : "s"} of ${request.leaveType.name.toLowerCase()}`,
          body: `Approved by ${actorName}. Waiting with you.`,
          link: next.approver === "MANAGER" ? "/team/approvals" : "/hr/approvals",
        })),
        tx,
      );

      await record({
        action: "leave.approved_step",
        actor: actorFrom({ id: actor.userId, fullName: actorName, role: actor.role }),
        targetType: "leaveRequest",
        targetId: request.id,
        targetLabel: `${request.employee.fullName} — ${request.leaveType.name}`,
        detail: { step: request.currentStep, passedTo: next.approver },
        ip,
        tx,
      });

      return { kind: "passed" as const, shortfall: 0 };
    }

    // Rule 3 — the last step. This is the only moment the leave is granted.
    await tx.leaveRequest.update({
      where: { id: request.id },
      data: { status: "GRANTED", currentApproverRole: null, decidedAt: new Date() },
    });

    const { shortfall } = await consumeEntitlement(tx, request.id);

    // The applicant AND every person who approved it along the way, together.
    const approverUserIds = [
      ...new Set(
        [...request.approvals.map((a) => a.approverId), actor.userId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    await notify(
      [
        {
          userId: request.employee.user.id,
          title: `Your ${request.leaveType.name.toLowerCase()} is granted`,
          body: `${cost} day${cost === 1 ? "" : "s"}, ${formatDate(first)} to ${formatDate(last)}.`,
          link: "/me/leave",
        },
        ...approverUserIds.map((userId) => ({
          userId,
          title: `${request.employee.fullName}'s leave is granted`,
          body: `${cost} day${cost === 1 ? "" : "s"}, ${formatDate(first)} to ${formatDate(last)}. You approved this.`,
          link: "/me/leave",
        })),
      ],
      tx,
    );

    await record({
      action: "leave.granted",
      actor: actorFrom({ id: actor.userId, fullName: actorName, role: actor.role }),
      targetType: "leaveRequest",
      targetId: request.id,
      targetLabel: `${request.employee.fullName} — ${request.leaveType.name}`,
      detail: {
        workingDays: cost,
        from: formatDate(first),
        to: formatDate(last),
        approvers: request.approvals.map((a) => a.approverName).concat(actorName),
        ...(shortfall > 0 ? { entitlementShortfall: shortfall } : {}),
      },
      ip,
      tx,
    });

    return { kind: "granted" as const, shortfall };
  });

  // After the transaction commits, never inside it. An email that fails must
  // not roll back a decision that was made.
  if (outcome.kind === "denied") {
    await sendMail({
      to: request.employee.user.email,
      subject: `Your ${request.leaveType.name.toLowerCase()} was not approved`,
      html: layout({
        heading: "Your leave was not approved",
        lines: [
          `${escapeHtml(formatDate(first))} to ${escapeHtml(formatDate(last))}, ${cost} working day${cost === 1 ? "" : "s"}.`,
          `<strong>${escapeHtml(actorName)}</strong> wrote: ${escapeHtml(written)}`,
        ],
        link: { label: "See it in the system", href: "/me/leave" },
      }),
    });
  } else if (outcome.kind === "granted") {
    await sendMail({
      to: request.employee.user.email,
      subject: `Your ${request.leaveType.name.toLowerCase()} is granted`,
      html: layout({
        heading: "Your leave is granted",
        lines: [
          `${escapeHtml(formatDate(first))} to ${escapeHtml(formatDate(last))}, ${cost} working day${cost === 1 ? "" : "s"}.`,
          "The days have come off your balance.",
        ],
        link: { label: "See it in the system", href: "/me/leave" },
      }),
    });
  }

  return { ok: true, outcome: outcome.kind };
}

async function approversFor(
  tx: Prisma.TransactionClient,
  role: Role,
  managerEmployeeId: string | null,
): Promise<{ id: string }[]> {
  if (role === "MANAGER") {
    if (!managerEmployeeId) return [];
    const manager = await tx.employee.findUnique({
      where: { id: managerEmployeeId },
      select: { userId: true },
    });
    return manager ? [{ id: manager.userId }] : [];
  }
  return tx.user.findMany({ where: { role, disabledAt: null }, select: { id: true } });
}
