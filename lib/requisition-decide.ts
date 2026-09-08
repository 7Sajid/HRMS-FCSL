import type { Prisma, Role } from "@prisma/client";
import { lostTheRace, prisma } from "./db";
import { actorFrom, record } from "./audit";
import { notify } from "./notifications";
import { requisitionChain } from "./approval-chain";
import { requisitionLabel } from "./requisitions";

/**
 * Deciding a requisition (§7.2).
 *
 * "Raised by a manager or HR → HR Head → Super Admin, but only if it is above
 * the value FCSL sets. Below that value the HR Head's approval is final."
 *
 * Same shape as the leave chain and for the same reason: the rule lives in a
 * library that takes an explicit actor, so the HR Head's inbox and the Super
 * Admin's call one implementation and a test can call exactly what they call.
 */

export type Decider = { userId: string; role: Role; employeeId: string | null; name: string };
export type Outcome = "denied" | "passed" | "approved";
export type Result = { ok: true; outcome: Outcome } | { error: string };

export async function decideRequisition(
  actor: Decider,
  requisitionId: string,
  decision: "APPROVE" | "DENY",
  reason: string,
  ip = "",
): Promise<Result> {
  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: {
      approvals: { orderBy: { step: "asc" } },
      raisedBy: { include: { user: { select: { id: true } } } },
    },
  });
  if (!requisition) return { error: "Not found." };
  if (requisition.status !== "PENDING") return { error: "This has already been decided." };

  // The threshold this request was RAISED under, not today's. A request must
  // travel the chain it was given: moving the setting while something waits in
  // an inbox used to change how many signatures it needed, in either
  // direction, with nothing on the record to say so.
  //
  // Falling back to the live setting only for rows raised before the column
  // existed — there is no better answer available for those.
  const threshold =
    requisition.escalationThreshold !== null
      ? Number(requisition.escalationThreshold)
      : Number(
          (await prisma.setting.findUnique({ where: { key: "requisition.escalationThreshold" } }))
            ?.value ?? 50000,
        );
  const amount = requisition.amount ? Number(requisition.amount) : null;
  const chain = requisitionChain(amount !== null && amount > threshold);

  // One step at a time, in order — the same rule as leave.
  if (chain[requisition.currentStep] !== actor.role) {
    return { error: "This is not waiting with you." };
  }

  const written = reason.trim().slice(0, 1000);
  if (decision === "DENY" && written.length < 5) {
    return { error: "Please give a reason. The person who raised it sees exactly what you write." };
  }

  const label = requisitionLabel(requisition.type);
  const next = chain[requisition.currentStep + 1] ?? null;

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.requisitionApproval.create({
      data: {
        requisitionId,
        step: requisition.currentStep,
        approverRole: actor.role,
        approverId: actor.userId,
        approverName: actor.name,
        decision: decision === "APPROVE" ? "GRANTED" : "DENIED",
        reason: written,
      },
    });

    if (decision === "DENY") {
      await tx.requisition.update({
        where: { id: requisitionId },
        data: { status: "DENIED", currentApproverRole: null, decidedAt: new Date() },
      });
      // A denial ends it. Nobody above is told.
      await notify(
        {
          userId: requisition.raisedBy.user.id,
          title: `Your requisition was denied`,
          body: `${actor.name}: ${written}`,
          link: "/team/requisitions",
        },
        tx,
      );
      await writeAudit(tx, actor, "requisition.denied", requisition.id, label, {
        step: requisition.currentStep,
        reason: written,
      }, ip);
      return "denied" as const;
    }

    if (next) {
      await tx.requisition.update({
        where: { id: requisitionId },
        data: { currentStep: requisition.currentStep + 1, currentApproverRole: next },
      });
      const approvers = await tx.user.findMany({
        where: { role: next, disabledAt: null },
        select: { id: true },
      });
      await notify(
        approvers.map((u) => ({
          userId: u.id,
          title: `${requisition.raisedByName} — ${label.toLowerCase()}`,
          body: amount ? `৳${amount.toLocaleString("en-BD")}, above the threshold.` : "",
          link: "/admin/approvals",
        })),
        tx,
      );
      await writeAudit(tx, actor, "requisition.approved_step", requisition.id, label, {
        step: requisition.currentStep,
        passedTo: next,
      }, ip);
      return "passed" as const;
    }

    await tx.requisition.update({
      where: { id: requisitionId },
      data: { status: "APPROVED", currentApproverRole: null, decidedAt: new Date() },
    });
    await notify(
      {
        userId: requisition.raisedBy.user.id,
        title: "Your requisition is approved",
        body: amount ? `৳${amount.toLocaleString("en-BD")}` : label,
        link: "/team/requisitions",
      },
      tx,
    );
    await writeAudit(tx, actor, "requisition.approved", requisition.id, label, {
      amount,
      approvers: requisition.approvals.map((a) => a.approverName).concat(actor.name),
    }, ip);
    return "approved" as const;
  }).catch((error: unknown) => {
    // Same shape as leave: the unique index on (requisition, step) keeps the
    // rule when two people decide at once, and this is how the one who lost
    // gets a sentence rather than a crash.
    if (lostTheRace(error)) return null;
    throw error;
  });

  if (outcome === null) return { error: "This has already been decided." };

  return { ok: true, outcome };
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  actor: Decider,
  action: "requisition.denied" | "requisition.approved_step" | "requisition.approved",
  id: string,
  label: string,
  detail: Prisma.InputJsonValue,
  ip: string,
): Promise<void> {
  await record({
    action,
    actor: actorFrom({ id: actor.userId, fullName: actor.name, role: actor.role }),
    targetType: "requisition",
    targetId: id,
    targetLabel: label,
    detail,
    ip,
    tx,
  });
}

/** Admin, IT or Accounts marks it done — §6.4's "ends with" column. */
export async function fulfilRequisition(
  actor: Decider,
  requisitionId: string,
  note: string,
): Promise<Result> {
  const requisition = await prisma.requisition.findUnique({ where: { id: requisitionId } });
  if (!requisition) return { error: "Not found." };
  if (requisition.status !== "APPROVED") return { error: "This has not been approved yet." };

  await prisma.$transaction(async (tx) => {
    await tx.requisition.update({
      where: { id: requisitionId },
      data: { status: "FULFILLED", fulfilledAt: new Date(), fulfilmentNote: note.trim().slice(0, 300) },
    });
    await record({
      action: "requisition.fulfilled",
      actor: actorFrom({ id: actor.userId, fullName: actor.name, role: actor.role }),
      targetType: "requisition",
      targetId: requisitionId,
      targetLabel: requisitionLabel(requisition.type),
      detail: { note: note || undefined },
      tx,
    });
  });

  return { ok: true, outcome: "approved" };
}
