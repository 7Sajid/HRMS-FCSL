import type { DocumentKind, Employee, EmployeeDocument, StaffType } from "@prisma/client";
import { prisma } from "./db";
import { onboardingChecklist, requiredKinds, type DocumentSpec } from "./documents";

/**
 * The state of one person's locked door (§3, §4).
 *
 * Computed rather than stored, so it cannot drift from the documents actually
 * on file. The screen, the Submit button and HR's review queue all read the
 * same answer from here.
 */

export type BoxState = {
  spec: DocumentSpec;
  required: boolean;
  documents: EmployeeDocument[];
  /** Green: something acceptable is on file. */
  satisfied: boolean;
  /**
   * Closed to further uploads because HR has accepted it. §4: "Only those
   * boxes reopen. Everything already accepted stays accepted, so nothing is
   * uploaded twice."
   */
  locked: boolean;
  /** HR's reason, when this box was the one sent back. */
  rejectionReason: string;
};

export type OnboardingState = {
  boxes: BoxState[];
  progress: { done: number; total: number; label: string; complete: boolean };
  bankComplete: boolean;
  contactComplete: boolean;
  /** Everything required is green and Submit can be pressed. */
  canSubmit: boolean;
  missing: string[];
};

export async function loadOnboardingState(employee: Employee): Promise<OnboardingState> {
  const [documents, bank, contacts] = await Promise.all([
    prisma.employeeDocument.findMany({
      where: { employeeId: employee.id, supersededAt: null },
      orderBy: { uploadedAt: "asc" },
    }),
    prisma.employeeBankDetail.findUnique({ where: { employeeId: employee.id } }),
    prisma.emergencyContact.findMany({
      where: { employeeId: employee.id, status: { in: ["CURRENT", "PENDING"] } },
    }),
  ]);

  const bankComplete = Boolean(
    bank?.accountName && bank.accountNumber && bank.bankName && bank.branchName,
  );
  // §4: one contact is mandatory, and a name without a number is not a contact.
  const contactComplete = contacts.some((c) => c.slot === 1 && c.name && c.mobile);

  const boxes: BoxState[] = onboardingChecklist(employee.staffType).map((spec) => {
    const mine = documents.filter((d) => d.kind === spec.kind);
    const accepted = mine.filter((d) => d.status === "ACCEPTED");
    const live = mine.filter((d) => d.status !== "REJECTED");
    const rejected = mine.filter((d) => d.status === "REJECTED");

    const satisfied = spec.isForm ? bankComplete : live.length > 0;

    return {
      spec,
      required: requiredKindSet(employee.staffType).has(spec.kind),
      documents: mine,
      satisfied,
      // Once HR has accepted a document the box closes — unless it allows
      // several files under one heading, where more may still be added.
      locked: !spec.isForm && accepted.length > 0 && !spec.multiple,
      rejectionReason: rejected.at(-1)?.rejectionReason ?? "",
    };
  });

  const satisfiedKinds = new Set<DocumentKind>(
    boxes.filter((b) => b.satisfied).map((b) => b.spec.kind),
  );
  const required = requiredKinds(employee.staffType);
  const done = required.filter((k) => satisfiedKinds.has(k)).length;

  const missing = boxes
    .filter((b) => b.required && !b.satisfied)
    .map((b) => b.spec.label)
    .concat(contactComplete ? [] : ["An emergency contact"]);

  return {
    boxes,
    progress: {
      done,
      total: required.length,
      label: `${done} of ${required.length} required documents uploaded`,
      complete: done === required.length,
    },
    bankComplete,
    contactComplete,
    canSubmit: done === required.length && contactComplete,
    missing,
  };
}

/**
 * Just the progress line, for a list of people, in three queries.
 *
 * The joiners queue printed "6 of 9 required documents uploaded" beside every
 * person who had not submitted yet, and called `loadOnboardingState` to get
 * it — three queries each. On the morning after the 412 import that is a page
 * that does not finish loading.
 *
 * It answers the same question the same way: a required box is satisfied by a
 * document that is not rejected, except the bank-details box, which is a form.
 */
export async function progressLabels(
  employees: readonly { id: string; staffType: StaffType }[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  if (!employees.length) return labels;
  const ids = employees.map((e) => e.id);

  const [documents, banks] = await Promise.all([
    prisma.employeeDocument.groupBy({
      by: ["employeeId", "kind"],
      where: { employeeId: { in: ids }, supersededAt: null, status: { not: "REJECTED" } },
    }),
    prisma.employeeBankDetail.findMany({
      where: { employeeId: { in: ids } },
      select: { employeeId: true, accountName: true, accountNumber: true, bankName: true, branchName: true },
    }),
  ]);

  const held = new Map<string, Set<DocumentKind>>();
  for (const row of documents) {
    const set = held.get(row.employeeId);
    if (set) set.add(row.kind);
    else held.set(row.employeeId, new Set([row.kind]));
  }
  const bankComplete = new Set(
    banks
      .filter((b) => b.accountName && b.accountNumber && b.bankName && b.branchName)
      .map((b) => b.employeeId),
  );

  for (const employee of employees) {
    const mine = held.get(employee.id) ?? new Set<DocumentKind>();
    const required = requiredKinds(employee.staffType);
    const done = required.filter((kind) =>
      kind === "BANK_DETAILS" ? bankComplete.has(employee.id) : mine.has(kind),
    ).length;
    labels.set(employee.id, `${done} of ${required.length} required documents uploaded`);
  }

  return labels;
}

const REQUIRED_CACHE = new Map<StaffType, Set<DocumentKind>>();
function requiredKindSet(staffType: StaffType): Set<DocumentKind> {
  let set = REQUIRED_CACHE.get(staffType);
  if (!set) {
    set = new Set(requiredKinds(staffType));
    REQUIRED_CACHE.set(staffType, set);
  }
  return set;
}
