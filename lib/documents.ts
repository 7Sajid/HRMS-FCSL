import type { DocumentKind, StaffType } from "@prisma/client";

/**
 * The document catalogue (§4 step 3).
 *
 * One source for three screens: the boxes on the locked door, the "6 of 9
 * required documents uploaded" counter, and HR's review checklist. A document
 * that exists on one and not the others is a document somebody is asked for
 * and then never checked, or checked and never asked for.
 *
 * Note the specification's table has three columns — Employee, RM, Manager/HR
 * — and the Employee and Manager/HR columns are identical in every single row.
 * Only being an RM changes what is demanded, so that is the only axis here.
 */

export type Requirement = "required" | "optional" | "not_applicable";

export type DocumentSpec = {
  kind: DocumentKind;
  label: string;
  note: string;
  staff: Requirement;
  rm: Requirement;
  /** Several files under one heading — "All educational certificates". */
  multiple: boolean;
  /** Structured fields rather than an uploaded file. */
  isForm?: boolean;
  /** Issue and expiry dates are captured with the file. */
  capturesDates?: boolean;
  accepts: readonly string[];
  /** Not on the joining list — added later, and never holds up the door. */
  laterOnly?: boolean;
};

const PDF = ["application/pdf"] as const;
const SCAN = ["application/pdf", "image/jpeg", "image/png"] as const;
const IMAGE = ["image/jpeg", "image/png"] as const;

export const DOCUMENT_CATALOGUE: readonly DocumentSpec[] = [
  {
    kind: "CV",
    label: "CV",
    note: "PDF only.",
    staff: "required",
    rm: "required",
    multiple: false,
    accepts: PDF,
  },
  {
    kind: "NID",
    label: "National ID",
    note: "Both sides.",
    staff: "required",
    rm: "required",
    multiple: true,
    accepts: SCAN,
  },
  {
    kind: "PHOTOGRAPH",
    label: "Photograph",
    note: "Becomes your profile picture and the photo on your ID card.",
    staff: "required",
    rm: "required",
    multiple: false,
    accepts: IMAGE,
  },
  {
    kind: "EDUCATION_CERTIFICATE",
    label: "Educational certificates",
    note: "All of them. Several files allowed under this one heading.",
    staff: "required",
    rm: "required",
    multiple: true,
    accepts: SCAN,
  },
  {
    kind: "EXPERIENCE_LETTER",
    label: "Experience letter",
    note: "From your previous employer.",
    staff: "optional",
    rm: "required",
    multiple: true,
    accepts: SCAN,
  },
  {
    kind: "RELEASE_LETTER",
    label: "Release letter",
    note: "From your previous employer.",
    staff: "optional",
    rm: "required",
    multiple: true,
    accepts: SCAN,
  },
  {
    kind: "APPOINTMENT_LETTER",
    label: "Appointment letter",
    // §10 problem 1 in v1.0: the original draft demanded letters FCSL had not
    // issued yet, which meant nobody could ever finish onboarding. FCSL's
    // answer was that the joiner already holds these two by their joining day.
    note: "Issued by FCSL when you accepted the offer, so you already have it.",
    staff: "required",
    rm: "required",
    multiple: false,
    accepts: SCAN,
  },
  {
    kind: "JOINING_LETTER",
    label: "Joining letter",
    note: "Signed on your joining day, before this account is used.",
    staff: "required",
    rm: "required",
    multiple: false,
    accepts: SCAN,
  },
  {
    kind: "RM_CERTIFICATE",
    label: "RM certificate",
    note: "The BSEC licence. Enter its number, issue date and expiry date with it.",
    staff: "not_applicable",
    rm: "required",
    multiple: false,
    capturesDates: true,
    accepts: SCAN,
  },
  {
    kind: "BANK_DETAILS",
    label: "Bank details",
    note: "Account name, number, bank, branch and routing number.",
    staff: "required",
    rm: "required",
    multiple: false,
    isForm: true,
    accepts: [],
  },
  {
    kind: "TRAINING_CERTIFICATE",
    label: "Training certificates",
    note: "Optional, and can be added at any time later.",
    staff: "optional",
    rm: "optional",
    multiple: true,
    accepts: SCAN,
  },

  // --- Two that arrive later, and never hold up the locked door (§4) --------
  {
    kind: "CONFIRMATION_LETTER",
    label: "Confirmation letter",
    note: "Added once probation ends.",
    staff: "optional",
    rm: "optional",
    multiple: false,
    laterOnly: true,
    accepts: SCAN,
  },
  {
    kind: "CLEARANCE_DOCUMENT",
    label: "Clearance documents",
    note: "From a previous employer, whenever they arrive.",
    staff: "optional",
    rm: "optional",
    multiple: true,
    laterOnly: true,
    accepts: SCAN,
  },
];

const BY_KIND = new Map(DOCUMENT_CATALOGUE.map((d) => [d.kind, d]));

export function documentSpec(kind: DocumentKind): DocumentSpec | undefined {
  return BY_KIND.get(kind);
}

export function documentLabel(kind: DocumentKind): string {
  return BY_KIND.get(kind)?.label ?? kind.replace(/_/g, " ").toLowerCase();
}

export function requirementFor(spec: DocumentSpec, staffType: StaffType): Requirement {
  return staffType === "RM" ? spec.rm : spec.staff;
}

/** The boxes on the locked door, in the order §4 lists them. */
export function onboardingChecklist(staffType: StaffType): DocumentSpec[] {
  return DOCUMENT_CATALOGUE.filter(
    (spec) => !spec.laterOnly && requirementFor(spec, staffType) !== "not_applicable",
  );
}

/** What must be green before Submit stops being grey. */
export function requiredKinds(staffType: StaffType): DocumentKind[] {
  return onboardingChecklist(staffType)
    .filter((spec) => requirementFor(spec, staffType) === "required")
    .map((spec) => spec.kind);
}

/**
 * Everything a person may add after their panel opens — §5.1 page 2: "an
 * employee can add a training certificate, a confirmation letter or clearance
 * documents at any time, but cannot replace or delete a document HR has
 * already accepted."
 */
export function laterUploadKinds(staffType: StaffType): DocumentSpec[] {
  return DOCUMENT_CATALOGUE.filter(
    (spec) => requirementFor(spec, staffType) !== "not_applicable" && !spec.isForm,
  );
}

/** "6 of 9 required documents uploaded". */
export function progressFor(
  staffType: StaffType,
  satisfied: ReadonlySet<DocumentKind>,
): { done: number; total: number; label: string; complete: boolean } {
  const required = requiredKinds(staffType);
  const done = required.filter((kind) => satisfied.has(kind)).length;
  return {
    done,
    total: required.length,
    label: `${done} of ${required.length} required documents uploaded`,
    complete: done === required.length,
  };
}
