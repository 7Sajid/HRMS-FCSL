import type { RequisitionType } from "@prisma/client";

/**
 * §6.4 — one form, four types.
 *
 * "The form changes to suit the type chosen, but the journey afterwards is the
 * same for all of them, which is why it is one feature and not four."
 *
 * Raised by managers, HR and the Super Admin only. Employees and RMs ask their
 * manager, who raises it on their behalf — so every requisition already has a
 * manager behind it before it reaches HR.
 */

export type FieldSpec = {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "textarea";
  required: boolean;
  hint?: string;
};

export type RequisitionSpec = {
  type: RequisitionType;
  label: string;
  /** What §6.4's table says it ends with. */
  endsWith: string;
  fields: FieldSpec[];
  /** Money/expense is the only one that carries an amount. */
  hasAmount: boolean;
  allowsAttachment: boolean;
};

export const REQUISITION_TYPES: readonly RequisitionSpec[] = [
  {
    type: "OFFICE_SUPPLIES",
    label: "Office supplies",
    endsWith: "Admin issues it and marks it delivered.",
    hasAmount: false,
    allowsAttachment: false,
    fields: [
      { name: "item", label: "Item", type: "text", required: true },
      { name: "quantity", label: "How many", type: "number", required: true },
      { name: "neededBy", label: "When needed", type: "date", required: false },
    ],
  },
  {
    type: "IT_EQUIPMENT",
    label: "IT equipment",
    endsWith: "IT issues it, and the item is recorded against the person.",
    hasAmount: false,
    allowsAttachment: false,
    fields: [
      { name: "item", label: "Item", type: "text", required: true },
      { name: "specification", label: "Specification", type: "textarea", required: false },
      {
        name: "replacement",
        label: "Replacement or additional",
        type: "text",
        required: true,
        hint: "Say which — it changes what IT has to do.",
      },
      { name: "neededBy", label: "When needed", type: "date", required: false },
    ],
  },
  {
    type: "MONEY_EXPENSE",
    label: "Money or expense",
    endsWith: "Accounts pays it and marks it settled.",
    hasAmount: true,
    allowsAttachment: true,
    fields: [
      { name: "purpose", label: "Purpose", type: "textarea", required: true },
      {
        name: "kind",
        label: "Advance or reimbursement",
        type: "text",
        required: true,
        hint: "An advance is money before, a reimbursement is money back.",
      },
    ],
  },
  {
    type: "NEW_STAFF",
    label: "A request for new staff",
    endsWith: "HR opens recruitment outside this system.",
    hasAmount: true,
    allowsAttachment: false,
    fields: [
      { name: "position", label: "Position", type: "text", required: true },
      { name: "headcount", label: "How many", type: "number", required: true },
      { name: "why", label: "Why", type: "textarea", required: true },
      { name: "neededBy", label: "When needed", type: "date", required: false },
    ],
  },
];

const BY_TYPE = new Map(REQUISITION_TYPES.map((r) => [r.type, r]));

export function requisitionSpec(type: RequisitionType): RequisitionSpec | undefined {
  return BY_TYPE.get(type);
}

export function requisitionLabel(type: RequisitionType): string {
  return BY_TYPE.get(type)?.label ?? type;
}

/**
 * Pull only the fields this type declares out of a form.
 *
 * Whitelisted rather than swept up, so a hand-crafted post cannot store
 * arbitrary keys in a JSON column that screens later render.
 */
export function collectDetails(
  spec: RequisitionSpec,
  read: (name: string) => string,
): { details: Record<string, string>; missing: string[] } {
  const details: Record<string, string> = {};
  const missing: string[] = [];
  for (const field of spec.fields) {
    const value = read(field.name).trim().slice(0, 500);
    if (!value) {
      if (field.required) missing.push(field.label);
      continue;
    }
    details[field.name] = value;
  }
  return { details, missing };
}
