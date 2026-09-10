import type { Role } from "@prisma/client";

/**
 * How an approval travels (§7).
 *
 * A compile-time map, not a database table. OrangeHRM models this as
 * (flow, state, role, action) rows with no foreign keys and no uniqueness
 * constraint, where a typo in a resulting state silently produces a state
 * nothing can leave. Here a wrong role does not compile.
 *
 * Move it into the database on the day non-developers genuinely need to edit
 * approval routes, and not before.
 */

/**
 * §7.1 — every leave application in the company ends at the Super Admin. How
 * many steps it takes to get there depends on who applied.
 */
export const LEAVE_CHAIN: Record<Role, readonly Role[]> = {
  EMPLOYEE: ["MANAGER", "HR_HEAD", "SUPER_ADMIN"],
  MANAGER: ["HR_HEAD", "SUPER_ADMIN"],
  HR_EXECUTIVE: ["HR_HEAD", "SUPER_ADMIN"],
  HR_HEAD: ["SUPER_ADMIN"],
  // "No approval needed. Recorded directly."
  SUPER_ADMIN: [],
};

/**
 * §7.2 — a requisition goes to the HR Head, and above a value FCSL sets, to
 * the Super Admin. Below that value the HR Head's approval is final.
 *
 * The HR Head's OWN requisition skips their desk and goes to the Super Admin
 * whatever the amount, the same shape as their own leave (§7.1). Otherwise it
 * lands in their own inbox and they approve it themselves — which mattered
 * little while anybody in HR could raise one, and matters now that FCSL has
 * named the HR Head as one of only two kinds of person who can.
 */
export function requisitionChain(aboveThreshold: boolean, raiserRole: Role): readonly Role[] {
  if (raiserRole === "HR_HEAD") return ["SUPER_ADMIN"];
  return aboveThreshold ? ["HR_HEAD", "SUPER_ADMIN"] : ["HR_HEAD"];
}

export type ChainPosition = {
  /** Who holds it now, or null when the chain is finished. */
  approver: Role | null;
  step: number;
  totalSteps: number;
  isFinalStep: boolean;
};

export function chainStart(applicantRole: Role): ChainPosition {
  const chain = LEAVE_CHAIN[applicantRole] ?? [];
  return {
    approver: chain[0] ?? null,
    step: 0,
    totalSteps: chain.length,
    isFinalStep: chain.length === 1,
  };
}

/** Where the application goes after this step approves it. */
export function chainAdvance(applicantRole: Role, currentStep: number): ChainPosition {
  const chain = LEAVE_CHAIN[applicantRole] ?? [];
  const next = currentStep + 1;
  return {
    approver: chain[next] ?? null,
    step: next,
    totalSteps: chain.length,
    isFinalStep: next === chain.length - 1,
  };
}

/** May this role act on an application currently sitting at this step? */
export function canDecideAt(applicantRole: Role, step: number, actorRole: Role): boolean {
  const chain = LEAVE_CHAIN[applicantRole] ?? [];
  // Nobody can skip a step and nobody can approve out of turn (§7.1 rule 1).
  return chain[step] === actorRole;
}

/**
 * Who is told when the Super Admin finally approves: the applicant AND every
 * person who approved it along the way (§7.1 rule 3).
 */
export function everyApproverRole(applicantRole: Role): readonly Role[] {
  return LEAVE_CHAIN[applicantRole] ?? [];
}

/**
 * "Waiting with your manager" — or with THEIR manager, depending on who is
 * reading it.
 *
 * The same sentence appears on the applicant's own page and on the Super
 * Admin's overview of everything in flight, and only the pronoun differs. One
 * function with a voice rather than two functions: the second copy is where
 * somebody eventually adds a chain step that the first copy never hears about.
 */
export function waitingWith(
  approver: Role | null,
  applicantRole: Role,
  voice: "self" | "other" = "self",
): string {
  if (!approver) return "Finished";
  if (approver === "MANAGER") return voice === "self" ? "Waiting with your manager" : "With their manager";
  if (approver === "HR_HEAD") return voice === "self" ? "Waiting with the HR Head" : "With the HR Head";
  if (approver === "SUPER_ADMIN")
    return voice === "self" ? "Waiting with the Super Admin" : "With the Super Admin";
  void applicantRole;
  return "Waiting";
}
