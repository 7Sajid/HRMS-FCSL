import type { ClearanceArea, EmployeeStatus, ExitReason } from "@prisma/client";

/**
 * §6.6 — exit and clearance.
 *
 * "An employee leaving is one of the highest-risk moments in a brokerage:
 * their trading terminal must be surrendered, their certificate status
 * changed, their system access closed the same day, and clearance obtained
 * from every department."
 */

export const CLEARANCE_CHECKLIST: { area: ClearanceArea; label: string }[] = [
  { area: "IT", label: "Laptop, phone and any other IT equipment returned" },
  { area: "IT", label: "Email and system accounts listed for closing" },
  { area: "ADMIN", label: "ID card returned" },
  { area: "ADMIN", label: "Office keys and access card returned" },
  { area: "ACCOUNTS", label: "Any outstanding advance settled" },
  { area: "ACCOUNTS", label: "Final dues calculated" },
  { area: "CLIENT_HANDOVER", label: "Client files handed over to a named colleague" },
  { area: "HR", label: "Exit interview held" },
  { area: "HR", label: "Release letter prepared" },
];

export const AREA_LABEL: Record<ClearanceArea, string> = {
  IT: "IT",
  ACCOUNTS: "Accounts",
  ADMIN: "Admin",
  HR: "HR",
  CLIENT_HANDOVER: "Client handover",
};

export const EXIT_REASONS = [
  { value: "RESIGNATION", label: "Resignation" },
  { value: "END_OF_CONTRACT", label: "End of contract" },
  { value: "TERMINATION", label: "Termination" },
  { value: "RETIREMENT", label: "Retirement" },
] as const;

/**
 * What stops an exit being finished.
 *
 * The terminal is the one §6.6 calls "the single most important safeguard in
 * the module", and it is a hard block rather than a warning: a surrendered
 * person holding a live trading terminal is precisely the thing a BSEC
 * inspection asks about.
 */
export function exitBlockers(state: {
  openTerminals: number;
  unclearedItems: number;
}): string[] {
  const blockers: string[] = [];
  if (state.openTerminals > 0) {
    blockers.push(
      `${state.openTerminals} trading terminal${state.openTerminals === 1 ? " is" : "s are"} still assigned to them. Surrender it before finishing the exit.`,
    );
  }
  if (state.unclearedItems > 0) {
    blockers.push(
      `${state.unclearedItems} clearance item${state.unclearedItems === 1 ? " is" : "s are"} still outstanding.`,
    );
  }
  return blockers;
}

/** §12.2 — files are purged one year after the last working day. */
export function purgeDateFor(lastWorkingDay: Date, years = 1): Date {
  const purge = new Date(lastWorkingDay.getTime());
  purge.setUTCFullYear(purge.getUTCFullYear() + years);
  return purge;
}

/**
 * Is this person's access closed?
 *
 * §6.6: "their system access closed the same day." The same day means the END
 * of the last working day — somebody serving a month's notice is still at work
 * and still needs the system.
 *
 * `completeExit` marks the record LEFT the moment HR finishes the exit, which
 * is normally weeks BEFORE the last working day. Reading `status === "LEFT"`
 * on its own would therefore lock people out while they are still employed;
 * reading nothing at all — which is what used to happen — left them signed in
 * for ever. It is the pair of facts that answers the question, never either
 * one alone.
 *
 * `lib/jobs.ts` disables the account itself so HR sees the truth on the
 * accounts screen. This is asked on every request as well, so the door is shut
 * from the first minute of the day after rather than from whenever the nightly
 * job next runs.
 */
export function accessClosed(
  employee: { status: EmployeeStatus; lastWorkingDay: Date | null } | null,
  today: Date,
): boolean {
  if (!employee || employee.status !== "LEFT") return false;
  // Marked LEFT with no date to wait for closes now. There is no reading of
  // that state under which the account should still open.
  return !employee.lastWorkingDay || employee.lastWorkingDay < today;
}

/**
 * The default wording of a release letter (§6.6 step 5).
 *
 * DRAFTED BY THE SOFTWARE, NOT BY FCSL. It is deliberately plain and says only
 * what the system actually knows: that the person was employed, in what role,
 * between which dates, and that they have been released. It makes no claim
 * about conduct or performance, because the system holds no opinion on either
 * and a letter that praises somebody by default is worth nothing to the person
 * who earns it.
 *
 * HR edits this on screen before the PDF is made, so FCSL's own wording wins
 * whenever it differs. The reason this is a template rather than a fixed
 * string is exactly that.
 */
export function releaseLetterTemplate(person: {
  fullName: string;
  designation: string | null;
  joiningDate: string;
  lastWorkingDay: string;
  reason: ExitReason;
}): string {
  const role = person.designation ? ` as ${person.designation}` : "";
  const leaving =
    person.reason === "RETIREMENT"
      ? "on retirement"
      : person.reason === "END_OF_CONTRACT"
        ? "on the completion of their contract"
        : "at their own request";

  return `This is to certify that ${person.fullName} was employed by First Capital Securities Limited${role} from ${person.joiningDate} to ${person.lastWorkingDay}.

Their employment ended ${leaving}. They have completed the company's clearance process and have no outstanding obligations to the company.

${person.fullName} is released from the service of First Capital Securities Limited with effect from ${person.lastWorkingDay}.

This letter is issued at their request and without prejudice.`;
}
