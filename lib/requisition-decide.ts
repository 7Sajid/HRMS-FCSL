import type { Prisma, Role } from "@prisma/client";
import { lostTheRace, prisma } from "./db";
import { actorFrom, record } from "./audit";
import { notify } from "./notifications";
import { requisitionChain } from "./approval-chain";
import { requisitionLabel } from "./requisitions";

/**
 * Deciding a requisition (§7.2).
 *
 * "Raised by a manager or HR → HR Head → Super Admin." Every one of them, as
 * FCSL decided on 1 October 2026 — the ৳50,000 threshold that used to stop
 * cheap ones at the HR Head is gone, and so is the idea that an approval is
 * where a requisition finishes. The HR Head names the department that will
 * action it, and once the Super Admin approves, that department's head is told
 * and closes it when the thing is actually done.
 *
 * Since 10 September 2026 only managers, department heads and the HR Head
 * raise one, and the HR Head's own goes straight to the Super Admin.
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
  /** The department the HR Head says will action this. Theirs alone to set. */
  actionDepartmentId: string | null = null,
): Promise<Result> {
  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: {
      approvals: { orderBy: { step: "asc" } },
      raisedBy: { include: { user: { select: { id: true, role: true } } } },
      actionDepartment: { include: { head: { include: { user: { select: { id: true } } } } } },
    },
  });
  if (!requisition) return { error: "Not found." };
  if (requisition.status !== "PENDING") return { error: "This has already been decided." };

  const amount = requisition.amount ? Number(requisition.amount) : null;
  // ponytail: the raiser's role as it is NOW, not as it was when raised. A
  // manager promoted to HR Head while their own requisition waits would find
  // it re-routed. Freeze it on the row if that ever happens rather than being
  // imagined.
  //
  // The amount no longer touches the route at all (FCSL, 1 October 2026).
  const chain = requisitionChain(requisition.raisedBy.user.role);

  // One step at a time, in order — the same rule as leave.
  if (chain[requisition.currentStep] !== actor.role) {
    return { error: "This is not waiting with you." };
  }

  const written = reason.trim().slice(0, 1000);
  if (decision === "DENY" && written.length < 5) {
    return { error: "Please give a reason. The person who raised it sees exactly what you write." };
  }

  // §7.2 as FCSL amended it on 1 October 2026: the HR Head names the department
  // that will action this, as they approve it.
  //
  // Asked for at their step rather than the Super Admin's because the HR Head
  // is the one desk every requisition crosses, and asked for on approval rather
  // than when it is raised because the manager asking for a laptop is not the
  // person who decides whose job it becomes.
  let department = requisition.actionDepartment;
  if (decision === "APPROVE" && actor.role === "HR_HEAD") {
    const wanted = actionDepartmentId ?? requisition.actionDepartmentId;
    if (!wanted) return { error: "Say which department will action this." };
    if (wanted !== department?.id) {
      department = await prisma.department.findFirst({
        where: { id: wanted, retiredAt: null },
        include: { head: { include: { user: { select: { id: true } } } } },
      });
      if (!department) return { error: "That department is not on the list any more." };
    }
  }
  // Written on every approval the HR Head makes, so changing their mind on a
  // requisition they are approving a second time is not a special case.
  const assignment =
    department && department.id !== requisition.actionDepartmentId
      ? { actionDepartmentId: department.id, actionDepartmentName: department.name }
      : {};

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
        data: { currentStep: requisition.currentStep + 1, currentApproverRole: next, ...assignment },
      });
      const approvers = await tx.user.findMany({
        where: { role: next, disabledAt: null },
        select: { id: true },
      });
      await notify(
        approvers.map((u) => ({
          userId: u.id,
          title: `${requisition.raisedByName} — ${label.toLowerCase()}`,
          body: amount ? `৳${amount.toLocaleString("en-BD")}` : "",
          link: "/admin/approvals",
        })),
        tx,
      );
      await writeAudit(tx, actor, "requisition.approved_step", requisition.id, label, {
        step: requisition.currentStep,
        passedTo: next,
        actionDepartment: department?.name,
      }, ip);
      return "passed" as const;
    }

    await tx.requisition.update({
      where: { id: requisitionId },
      data: { status: "APPROVED", currentApproverRole: null, decidedAt: new Date(), ...assignment },
    });

    // Three people are told, together (FCSL, 1 October 2026): whoever asked,
    // the HR Head who sent it up, and the department that now has to do
    // something about it.
    //
    // Keyed by user rather than pushed onto a list, because one person is
    // often two of those three — the HR Head raising their own requisition, a
    // department head raising one that lands back on their own desk — and
    // being told twice about one thing is how people learn to ignore the bell.
    const money = amount ? `৳${amount.toLocaleString("en-BD")}` : "";
    const told = new Map<string, { userId: string; title: string; body: string; link: string }>();

    told.set(requisition.raisedBy.user.id, {
      userId: requisition.raisedBy.user.id,
      title: "Your requisition is approved",
      body: department ? `${money} — ${department.name} will action it`.trim() : money || label,
      link: "/team/requisitions",
    });

    const hrHeads = await tx.user.findMany({
      where: { role: "HR_HEAD", disabledAt: null },
      select: { id: true },
    });
    for (const head of hrHeads) {
      if (told.has(head.id)) continue;
      told.set(head.id, {
        userId: head.id,
        title: `${requisition.raisedByName}'s requisition is approved`,
        body: department ? `${money} — with ${department.name}`.trim() : money || label,
        link: "/hr/approvals",
      });
    }

    const departmentHead = department?.head?.user.id ?? null;
    if (departmentHead && !told.has(departmentHead)) {
      told.set(departmentHead, {
        userId: departmentHead,
        title: `${label} for ${requisition.raisedByName} — yours to action`,
        body: money,
        link: "/team/requisitions",
      });
    }

    await notify([...told.values()], tx);

    await writeAudit(tx, actor, "requisition.approved", requisition.id, label, {
      amount,
      approvers: requisition.approvals.map((a) => a.approverName).concat(actor.name),
      actionDepartment: department?.name,
      // A department with nobody at the head of it leaves an approved
      // requisition with no one told, which is worth a line in the record
      // rather than silence.
      departmentHeadNotified: Boolean(departmentHead),
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

/**
 * IT, Accounts or whoever it was sent to marks it done — §6.4's "ends with"
 * column, and the last step of §7.2 since 1 October 2026.
 *
 * Before that the only people who could close one were the two who approve
 * requisitions, because no part of the system knew whose job the thing was.
 * Now it does: the HR Head named a department on the way up, and that
 * department's head is the person who actually handed over the laptop.
 */
export async function fulfilRequisition(
  actor: Decider,
  requisitionId: string,
  note: string,
  /**
   * Whether this actor may close any requisition at all, asked of
   * lib/permissions.ts by the caller. The HR Head and the Super Admin keep it,
   * so a department head being on leave does not strand a delivered laptop.
   */
  mayCloseAnything: boolean,
): Promise<Result> {
  const requisition = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: { actionDepartment: { select: { headId: true, name: true } } },
  });
  if (!requisition) return { error: "Not found." };
  if (requisition.status !== "APPROVED") return { error: "This has not been approved yet." };

  const isDepartmentHead =
    actor.employeeId !== null && requisition.actionDepartment?.headId === actor.employeeId;
  if (!isDepartmentHead && !mayCloseAnything) return { error: "This is not waiting with you." };

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
      detail: {
        note: note || undefined,
        department: requisition.actionDepartment?.name,
        closedByDepartmentHead: isDepartmentHead,
      },
      tx,
    });
  });

  return { ok: true, outcome: "approved" };
}
