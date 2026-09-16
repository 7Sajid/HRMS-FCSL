import { describe, expect, it } from "vitest";
import {
  DOCUMENT_CATALOGUE,
  documentLabel,
  laterUploadKinds,
  onboardingChecklist,
  progressFor,
  requiredKinds,
  requirementFor,
} from "./documents";
import type { DocumentKind } from "@prisma/client";

describe("§4 — what must be uploaded", () => {
  it("demands the same list of a manager and an ordinary employee", () => {
    // The specification's table has three columns and two of them are
    // identical in every row, so only staffType can change the answer.
    for (const spec of DOCUMENT_CATALOGUE) {
      expect(requirementFor(spec, "STAFF")).toBe(spec.staff);
    }
  });

  it("demands more of an Associate than of an employee", () => {
    const staff = new Set(requiredKinds("STAFF"));
    const rm = new Set(requiredKinds("RM"));

    // The three things that mark an Associate.
    expect(rm.has("EXPERIENCE_LETTER")).toBe(true);
    expect(rm.has("RELEASE_LETTER")).toBe(true);
    expect(rm.has("RM_CERTIFICATE")).toBe(true);

    expect(staff.has("EXPERIENCE_LETTER")).toBe(false);
    expect(staff.has("RELEASE_LETTER")).toBe(false);
    expect(staff.has("RM_CERTIFICATE")).toBe(false);

    // Everything an employee must supply, an Associate must supply too.
    for (const kind of staff) expect(rm.has(kind)).toBe(true);
  });

  it("never shows an employee the Associate certificate box at all", () => {
    const kinds = onboardingChecklist("STAFF").map((s) => s.kind);
    expect(kinds).not.toContain("RM_CERTIFICATE");
    expect(onboardingChecklist("RM").map((s) => s.kind)).toContain("RM_CERTIFICATE");
  });

  it("keeps the confirmation letter and clearance documents off the joining list", () => {
    // §4: "Neither one holds up the locked door." A joiner cannot produce a
    // confirmation letter that arrives six months later.
    for (const staffType of ["STAFF", "RM"] as const) {
      const kinds = onboardingChecklist(staffType).map((s) => s.kind);
      expect(kinds).not.toContain("CONFIRMATION_LETTER");
      expect(kinds).not.toContain("CLEARANCE_DOCUMENT");
    }
  });

  it("asks for the appointment and joining letters, which the joiner does hold", () => {
    // The v1.0 draft demanded letters FCSL had not issued yet, so nobody could
    // ever finish onboarding. FCSL's answer was that these two are in hand by
    // the joining day. They stay required.
    const kinds = requiredKinds("STAFF");
    expect(kinds).toContain("APPOINTMENT_LETTER");
    expect(kinds).toContain("JOINING_LETTER");
  });

  it("captures issue and expiry dates only with the Associate certificate", () => {
    const withDates = DOCUMENT_CATALOGUE.filter((s) => s.capturesDates).map((s) => s.kind);
    expect(withDates).toEqual(["RM_CERTIFICATE"]);
  });

  it("treats bank details as a form, not a file", () => {
    const bank = DOCUMENT_CATALOGUE.find((s) => s.kind === "BANK_DETAILS")!;
    expect(bank.isForm).toBe(true);
    expect(bank.accepts).toHaveLength(0);
    // ...but it still counts towards the progress line, because §4 puts it on
    // the same screen and the joiner has to complete it.
    expect(requiredKinds("STAFF")).toContain("BANK_DETAILS");
  });

  it("accepts a CV as PDF only, as the specification says", () => {
    const cv = DOCUMENT_CATALOGUE.find((s) => s.kind === "CV")!;
    expect(cv.accepts).toEqual(["application/pdf"]);
  });

  it("allows several files under one heading where the specification does", () => {
    const multiple = DOCUMENT_CATALOGUE.filter((s) => s.multiple).map((s) => s.kind);
    expect(multiple).toContain("EDUCATION_CERTIFICATE");
    expect(multiple).toContain("NID"); // both sides
    // A person has one appointment letter and one photograph.
    expect(multiple).not.toContain("APPOINTMENT_LETTER");
    expect(multiple).not.toContain("PHOTOGRAPH");
  });
});

describe("the progress line on the locked door", () => {
  it("reads the way §4 prints it", () => {
    const required = requiredKinds("RM");
    const some = new Set<DocumentKind>(required.slice(0, 6));
    const progress = progressFor("RM", some);
    expect(progress.label).toBe(`6 of ${required.length} required documents uploaded`);
    expect(progress.complete).toBe(false);
  });

  it("is complete only when every required box is green", () => {
    expect(progressFor("STAFF", new Set(requiredKinds("STAFF"))).complete).toBe(true);
    // An optional document does not move the counter.
    const partial = new Set<DocumentKind>([...requiredKinds("STAFF"), "TRAINING_CERTIFICATE"]);
    expect(progressFor("STAFF", partial).done).toBe(requiredKinds("STAFF").length);
  });

  it("starts at zero", () => {
    expect(progressFor("STAFF", new Set()).done).toBe(0);
    expect(progressFor("STAFF", new Set()).complete).toBe(false);
  });
});

describe("labels", () => {
  it("names every kind in the catalogue", () => {
    for (const spec of DOCUMENT_CATALOGUE) {
      expect(documentLabel(spec.kind)).toBe(spec.label);
      expect(spec.label).not.toMatch(/_/);
    }
  });

  it("falls back readably for a kind outside the catalogue", () => {
    // SHOWCAUSE_REPLY and the rest are real documents that are never part of
    // onboarding, so they have no catalogue entry and must still print.
    expect(documentLabel("SHOWCAUSE_REPLY")).toBe("showcause reply");
  });
});

describe("what an employee may add after their panel opens (§5.1 page 2)", () => {
  it("always offers the two that arrive later by nature", () => {
    const kinds = laterUploadKinds("STAFF", new Set(requiredKinds("STAFF"))).map((s) => s.kind);
    expect(kinds).toContain("CONFIRMATION_LETTER");
    expect(kinds).toContain("CLEARANCE_DOCUMENT");
    expect(kinds).toContain("TRAINING_CERTIFICATE");
  });

  it("stops asking for a single-file document already on file", () => {
    const onFile = new Set<DocumentKind>(["CV", "APPOINTMENT_LETTER"]);
    const kinds = laterUploadKinds("STAFF", onFile).map((s) => s.kind);
    expect(kinds).not.toContain("CV");
    expect(kinds).not.toContain("APPOINTMENT_LETTER");
  });

  it("keeps offering the ones that take several files", () => {
    const onFile = new Set<DocumentKind>(["NID", "EDUCATION_CERTIFICATE"]);
    const kinds = laterUploadKinds("STAFF", onFile).map((s) => s.kind);
    expect(kinds).toContain("NID");
    expect(kinds).toContain("EDUCATION_CERTIFICATE");
  });

  it("never offers an employee the Associate certificate", () => {
    expect(laterUploadKinds("STAFF", new Set()).map((s) => s.kind)).not.toContain("RM_CERTIFICATE");
    expect(laterUploadKinds("RM", new Set()).map((s) => s.kind)).toContain("RM_CERTIFICATE");
  });

  it("never offers bank details as a file", () => {
    expect(laterUploadKinds("RM", new Set()).map((s) => s.kind)).not.toContain("BANK_DETAILS");
  });
});
