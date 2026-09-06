"use server";

import { revalidatePath } from "next/cache";
import { currentIp, getSessionContext } from "@/lib/auth";
import { applyLeaveDecision } from "@/lib/leave-decide";

export type DecisionResult = { ok: true } | { error: string };

/**
 * Thin on purpose. Every export in a "use server" file is a callable HTTP
 * endpoint, so this resolves the session, hands the decision to the library,
 * and revalidates. The rule itself lives in lib/leave-decide.ts, where a test
 * can call exactly what this calls.
 */
export async function decideLeave(
  requestId: string,
  decision: "GRANT" | "DENY",
  reason: string,
): Promise<DecisionResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };

  const result = await applyLeaveDecision(
    {
      userId: context.user.id,
      role: context.user.role,
      employeeId: context.employeeId,
      name: context.employee?.fullName ?? context.user.email,
    },
    requestId,
    decision,
    reason,
    await currentIp(),
  );

  if ("error" in result) return result;

  revalidatePath("/team/approvals");
  revalidatePath("/hr/approvals");
  revalidatePath("/admin/approvals");
  revalidatePath("/me/leave");
  return { ok: true };
}
