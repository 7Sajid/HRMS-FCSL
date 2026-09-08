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

export type RequisitionResult = { ok: true; id: string } | { error: string };

const DEFAULT_THRESHOLD = 50_000;

export async function raiseRequisition(
  _previous: unknown,
  formData: FormData,
): Promise<RequisitionResult> {
  const context = await getSessionContext();
  if (!context?.employee) return { error: "Please sign in again." };

  // §6.4: managers, HR and the Super Admin only. Employees and RMs ask their
  // manager, who raises it on their behalf.
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

  const setting = await prisma.setting.findUnique({
    where: { key: "requisition.escalationThreshold" },
  });
  const threshold = Number(setting?.value ?? DEFAULT_THRESHOLD);
  // §7.2: above the value FCSL sets it goes on to the Super Admin; below it,
  // the HR Head's approval is final.
  const chain = requisitionChain(amount !== null && amount > threshold);

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
        // Frozen here. §7.2's chain is decided by the threshold as it stood
        // when the request was made, not by whatever it says on the day
        // somebody gets round to approving it.
        escalationThreshold: threshold.toFixed(2),
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
      detail: { type, amount, aboveThreshold: chain.length > 1, details },
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
        link: "/hr/approvals",
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
