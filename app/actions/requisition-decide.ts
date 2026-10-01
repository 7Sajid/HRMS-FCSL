"use server";

import { revalidatePath } from "next/cache";
import { currentIp, getSessionContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decideRequisition, fulfilRequisition } from "@/lib/requisition-decide";

export type Result = { ok: true } | { error: string };

export async function decideRequisitionAction(
  requisitionId: string,
  decision: "APPROVE" | "DENY",
  reason: string,
  /** The HR Head says who will action it; ignored for anybody else. */
  actionDepartmentId: string | null = null,
): Promise<Result> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "requisitions.approve")) return { error: "This is not waiting with you." };

  const result = await decideRequisition(
    {
      userId: context.user.id,
      role: context.user.role,
      employeeId: context.employeeId,
      name: context.employee?.fullName ?? context.user.email,
    },
    requisitionId,
    decision,
    reason,
    await currentIp(),
    actionDepartmentId,
  );
  if ("error" in result) return result;

  revalidatePath("/hr/approvals");
  revalidatePath("/admin/approvals");
  revalidatePath("/team/requisitions");
  return { ok: true };
}

export async function markFulfilled(requisitionId: string, note: string): Promise<Result> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };

  // Not a capability check any more. Since 1 October 2026 the person who closes
  // a requisition is usually the head of the department it was sent to, which
  // is a fact about this requisition rather than about their role — so the
  // capability answers only "may you close ANY of them", and the ownership
  // question is settled against the row itself.
  const result = await fulfilRequisition(
    {
      userId: context.user.id,
      role: context.user.role,
      employeeId: context.employeeId,
      name: context.employee?.fullName ?? context.user.email,
    },
    requisitionId,
    note,
    can(context.viewer, "requisitions.approve"),
  );
  if ("error" in result) return result;

  revalidatePath("/hr/approvals");
  revalidatePath("/team/requisitions");
  return { ok: true };
}
