/**
 * §6.5 — show-cause letters.
 *
 * "A show-cause is visible to the HR Head, the employee concerned, and nobody
 * else by default — not even their manager, unless the HR Head chooses to
 * include them. Every single time this record is opened, the system records
 * who opened it."
 *
 * That last sentence is why reading one is an action with a side effect rather
 * than a plain query.
 */

export const SHOWCAUSE_TEMPLATES = [
  {
    name: "Unexplained absence",
    body: `You were absent from your duties on [DATES] without prior approval or intimation.

Under the terms of your appointment and the Bangladesh Labour Act 2006, unauthorised absence is a breach of your obligations to the company.

You are required to explain, in writing and within three working days of receiving this letter, why disciplinary action should not be taken against you.`,
  },
  {
    name: "Persistent late attendance",
    body: `The attendance record for [MONTH] shows that you arrived late on [COUNT] occasions.

Punctuality is a condition of your employment and repeated lateness affects colleagues who depend on you.

You are required to explain, in writing and within three working days of receiving this letter, the reasons for this and what you propose to do about it.`,
  },
  {
    name: "Breach of company policy",
    body: `It has been brought to the attention of management that on [DATE] you [DESCRIBE].

This is a breach of [POLICY].

You are required to explain, in writing and within three working days of receiving this letter, why disciplinary action should not be taken against you.`,
  },
  {
    name: "Conduct with a client",
    body: `A complaint has been received concerning your conduct with a client on [DATE].

As a licensed intermediary, FCSL's standing with BSEC and with its clients rests on the conduct of every member of staff who deals with them.

You are required to explain, in writing and within three working days of receiving this letter, your account of what happened.`,
  },
] as const;

export const OUTCOMES = [
  { value: "NO_ACTION", label: "Closed with no action", tone: "success" as const },
  { value: "WARNING", label: "Warning issued", tone: "warn" as const },
  { value: "ESCALATED", label: "Escalated", tone: "danger" as const },
] as const;

export function outcomeLabel(value: string | null): string {
  return OUTCOMES.find((o) => o.value === value)?.label ?? "Open";
}

export function outcomeTone(value: string | null): "success" | "warn" | "danger" | "neutral" {
  return OUTCOMES.find((o) => o.value === value)?.tone ?? "neutral";
}
