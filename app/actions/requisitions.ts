"use server";

import { revalidatePath } from "next/cache";
import type { RequisitionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { requisitionChain } from "@/lib/approval-chain";
import { collectDetails, requisitionSpec } from "@/lib/requisitions";

export type RequisitionResult = { ok: true; id: string } | { error: string; field?: string };

export async function raiseRequisition(
  _previous: unknown,
  formData: FormData,
): Promise<RequisitionResult> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };

  // §6.4, as FCSL amended it on 10 September 2026: managers, department heads
  // and the HR Head only. Everybody else — employees, Associates, HR Executives — asks
  // their manager, who raises it on their behalf.
  if (!can(context.viewer, "requisitions.raise")) {
    return { error: "Ask your manager to raise this for you." };
  }

  const type = String(formData.get("type") ?? "") as RequisitionType;
  const spec = requisitionSpec(type);
  if (!spec) return { error: "Pick what you are asking for." };

  const { details, missing } = collectDetails(spec, (name) => String(formData.get(name) ?? ""));
  if (missing.length) return { error: `Still needed: ${missing.join(", ")}.` };

  let amount: number | null = null;
  if (spec.hasAmount) {
    const raw = String(formData.get("amount") ?? "").replace(/,/g, "").trim();
    amount = raw ? Number(raw) : NaN;
    if (!Number.isFinite(amount) || amount <= 0) {
      return { error: "Enter the amount in taka." };
    }
  }

  // §7.2, as FCSL amended it on 1 October 2026: every requisition travels the
  // same chain, whatever it costs.
  const chain = requisitionChain(context.user.role);

  // The HR Head names the department that will action it as they approve —
  // except on their own requisition, which skips their desk entirely, so they
  // name it here instead. Still the HR Head deciding, which is the rule.
  let department: { id: string; name: string } | null = null;
  if (context.user.role === "HR_HEAD") {
    const wanted = String(formData.get("actionDepartmentId") ?? "").trim();
    if (!wanted) return { error: "Say which department will action this.", field: "actionDepartmentId" };
    department = await prisma.department.findFirst({
      where: { id: wanted, retiredAt: null },
      select: { id: true, name: true },
    });
    if (!department) return { error: "That department is not on the list any more." };
  }

  const employee = context.employee;
  const ip = await currentIp();

  const created = await prisma.$transaction(async (tx) => {
    const requisition = await tx.requisition.create({
      data: {
        raisedById: employee.id,
        raisedByName: employee.fullName,
        type,
        details,
        amount: amount === null ? null : amount.toFixed(2),
        actionDepartmentId: department?.id ?? null,
        actionDepartmentName: department?.name ?? "",
        status: "PENDING",
        currentStep: 0,
        currentApproverRole: chain[0] ?? null,
      },
    });

    await record({
      action: "requisition.raised",
      actor: actorFrom({ ...context.user, fullName: employee.fullName }),
      targetType: "requisition",
      targetId: requisition.id,
      targetLabel: `${employee.fullName} — ${spec.label}`,
      detail: { type, amount, actionDepartment: department?.name, details },
      ip,
      tx,
    });

    const approvers = await tx.user.findMany({
      where: { role: chain[0]!, disabledAt: null },
      select: { id: true },
    });
    await notify(
      approvers.map((u) => ({
        userId: u.id,
        title: `${employee.fullName} raised a requisition — ${spec.label.toLowerCase()}`,
        body: amount ? `৳${amount.toLocaleString("en-BD")}` : "",
        // The HR Head's own requisition starts at the Super Admin's desk.
        link: chain[0] === "SUPER_ADMIN" ? "/admin/approvals" : "/hr/approvals",
      })),
      tx,
    );

    return requisition;
  });

  revalidatePath("/team/requisitions");
  return { ok: true, id: created.id };
}

export async function withdrawRequisition(id: string): Promise<{ ok: true } | { error: string }> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };

  const requisition = await prisma.requisition.findUnique({ where: { id } });
  if (!requisition || requisition.raisedById !== context.employee.id) return { error: "Not found." };
  if (requisition.status !== "PENDING") return { error: "This has already been decided." };

  const spec = requisitionSpec(requisition.type);
  const ip = await currentIp();

  // The update and its audit row are one transaction, like every other action
  // in this system. Withdrawal was the one write that recorded nothing, so a
  // requisition could leave an approver's inbox with no line saying who took
  // it out or when — which is exactly the question asked when somebody
  // remembers raising it and cannot find it.
  await prisma.$transaction(async (tx) => {
    await tx.requisition.update({
      where: { id },
      data: { status: "WITHDRAWN", currentApproverRole: null, decidedAt: new Date() },
    });
    await record({
      action: "requisition.withdrawn",
      actor: actorFrom({ ...context.user, fullName: context.employee!.fullName }),
      targetType: "requisition",
      targetId: id,
      targetLabel: `${requisition.raisedByName} — ${spec?.label ?? requisition.type}`,
      detail: {
        type: requisition.type,
        amount: requisition.amount === null ? null : Number(requisition.amount),
        wasWaitingWith: requisition.currentApproverRole,
      },
      ip,
      tx,
    });
  });

  revalidatePath("/team/requisitions");
  revalidatePath("/hr/approvals");
  return { ok: true };
}
