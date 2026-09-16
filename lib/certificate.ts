import { addDays, daysBetween, humanDaysUntil, todayInDhaka } from "./dates";

/**
 * The Associate certificate countdown (§5.1, §6.8, §12.2).
 *
 * The status is DERIVED from the expiry date every time it is asked for, and
 * never stored. A stored status needs something to keep it true, and that
 * something is always the job that quietly stops running — which for this
 * particular field means a licence lapsing without anybody being told, the
 * first of the six problems the system exists to fix.
 *
 * Four months, and it WARNS ONLY. FCSL decided the system never blocks the
 * person or their work, whatever the certificate says: blocking somebody's
 * account over a date typed in wrongly causes more damage than it prevents.
 */

export const WARN_MONTHS = 4;

export type CertificateState = "VALID" | "RENEWAL_DUE" | "EXPIRED" | "SURRENDERED" | "NONE";

export type CertificateStatus = {
  state: CertificateState;
  /** "Valid", "Renewal due", "Expired" — the words §5.1 asks for. */
  label: string;
  /** Green, amber, red. */
  tone: "success" | "warn" | "danger" | "neutral";
  /** The whole sentence, as the specification prints it. */
  sentence: string;
  daysRemaining: number | null;
};

/** The date at which the four-month warning starts for a given expiry. */
export function warningStarts(expiryDate: Date): Date {
  const start = new Date(expiryDate.getTime());
  start.setUTCMonth(start.getUTCMonth() - WARN_MONTHS);
  return start;
}

export function certificateStatus(
  certificate: { expiryDate: Date; status?: string } | null,
  today: Date = todayInDhaka(),
): CertificateStatus {
  if (!certificate) {
    return {
      state: "NONE",
      label: "Not recorded",
      tone: "neutral",
      sentence: "No Associate certificate is on file yet.",
      daysRemaining: null,
    };
  }

  if (certificate.status === "SURRENDERED") {
    return {
      state: "SURRENDERED",
      label: "Surrendered",
      tone: "neutral",
      sentence: "This certificate has been surrendered.",
      daysRemaining: null,
    };
  }

  const days = daysBetween(today, certificate.expiryDate);

  if (days < 0) {
    return {
      state: "EXPIRED",
      label: "Expired",
      tone: "danger",
      // Stays visible rather than being quietly hidden — an expired licence
      // sits at the top of HR's register until it is resolved (§6.8).
      sentence: `Expired ${humanDaysUntil(certificate.expiryDate, today)} ago. HR has been told.`,
      daysRemaining: days,
    };
  }

  const renewalDue = today >= warningStarts(certificate.expiryDate);

  return {
    state: renewalDue ? "RENEWAL_DUE" : "VALID",
    label: renewalDue ? "Renewal due" : "Valid",
    tone: renewalDue ? "warn" : "success",
    sentence: `${renewalDue ? "Renewal due" : "Valid"}. Expires ${formatExpiry(certificate.expiryDate)} — ${humanDaysUntil(certificate.expiryDate, today)} remaining.`,
    daysRemaining: days,
  };
}

function formatExpiry(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** For the register's "expiring in the next three, six, twelve months" (§6.10). */
export function expiringWithinMonths(expiryDate: Date, months: number, today = todayInDhaka()): boolean {
  const limit = new Date(today.getTime());
  limit.setUTCMonth(limit.getUTCMonth() + months);
  return expiryDate >= today && expiryDate <= limit;
}

/** Sorts the most urgent to the top: expired first, then soonest to expire. */
export function urgencyRank(expiryDate: Date, today = todayInDhaka()): number {
  return daysBetween(today, expiryDate);
}

export { addDays };
