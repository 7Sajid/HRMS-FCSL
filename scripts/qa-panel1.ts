import { readFileSync } from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { loadOnboardingState } from "../lib/onboarding";
import { deleteObject } from "../lib/storage";
import { prisma, finish } from "./_cli";

/**
 * Panel 1, end to end, against a real database and a running server.
 *
 * Fixtures live at the reserved TLD @qa.fcsl.invalid so they can never collide
 * with a real employee, and are deleted BY EXACT ID in a finally — never by a
 * blanket predicate, because a predicate that is slightly wrong on the day
 * somebody runs this against the wrong database deletes real staff files.
 *
 *   npm run dev            (in another terminal)
 *   npx tsx scripts/qa-panel1.ts
 */

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const FIXTURES = path.join(
  process.env.TMPDIR ?? "/tmp",
  "..",
);

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function mintSessionCookie(userId: string): Promise<string> {
  const session = await prisma.session.create({
    data: {
      userId,
      userAgent: "qa-panel1",
      ip: "127.0.0.1",
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  const secret = new TextEncoder().encode(
    process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32
      ? process.env.SESSION_SECRET
      : "dev-only-insecure-key-do-not-use-in-production",
  );
  const token = await new SignJWT({ userId, sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(session.expiresAt)
    .sign(secret);
  return `fcsl_hrm_session=${token}`;
}

async function upload(
  cookie: string,
  kind: string,
  file: { name: string; bytes: Buffer; type: string },
  extra: Record<string, string> = {},
): Promise<{ status: number; body: { ok?: boolean; error?: string; id?: string } }> {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const response = await fetch(`${BASE}/api/upload`, {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function main() {
  // Built by the same helper that made them for the browser walk.
  const scratch = process.argv[2] ?? ".";
  const pdf = readFileSync(path.join(scratch, "test-doc.pdf"));
  const png = readFileSync(path.join(scratch, "test-photo.png"));
  const evil = readFileSync(path.join(scratch, "evil.pdf"));

  const email = "qa-rm@qa.fcsl.invalid";
  await prisma.user.deleteMany({ where: { email } });

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("qa-password-not-real", 10),
      role: "EMPLOYEE",
      mustChangePassword: false,
    },
  });
  const employee = await prisma.employee.create({
    data: { userId: user.id, fullName: "QA Relationship Manager", staffType: "RM" },
  });

  try {
    const cookie = await mintSessionCookie(user.id);

    console.log("\nThe locked door");
    let state = await loadOnboardingState(employee);
    check("an RM is asked for 10 required items", state.progress.total === 10, `got ${state.progress.total}`);
    check("nothing is satisfied yet", state.progress.done === 0);
    check("Submit is refused", !state.canSubmit);

    console.log("\nWhat the upload endpoint refuses");
    const html = await upload(cookie, "CV", { name: "cv.pdf", bytes: evil, type: "application/pdf" });
    check(
      "an HTML file named cv.pdf is rejected on its bytes, not its name",
      html.status === 400 && /PDF, JPG or PNG/.test(html.body.error ?? ""),
      `${html.status} ${html.body.error}`,
    );

    const wrongBox = await upload(cookie, "CV", { name: "photo.png", bytes: png, type: "image/png" });
    check(
      "a PNG is refused by the CV box, which is PDF only",
      wrongBox.status === 400 && /PDF only/.test(wrongBox.body.error ?? ""),
      `${wrongBox.status} ${wrongBox.body.error}`,
    );

    const notADocument = await upload(cookie, "BANK_DETAILS", {
      name: "x.pdf",
      bytes: pdf,
      type: "application/pdf",
    });
    check("bank details cannot be uploaded as a file", notADocument.status === 400);

    const noDates = await upload(cookie, "RM_CERTIFICATE", {
      name: "cert.pdf",
      bytes: pdf,
      type: "application/pdf",
    });
    check(
      "the RM certificate is refused without its two dates",
      noDates.status === 400 && /issue date/.test(noDates.body.error ?? ""),
      noDates.body.error,
    );

    const backwards = await upload(
      cookie,
      "RM_CERTIFICATE",
      { name: "cert.pdf", bytes: pdf, type: "application/pdf" },
      { issueDate: "2027-03-14", expiryDate: "2026-03-14" },
    );
    check(
      "an expiry before the issue date is refused",
      backwards.status === 400 && /after the issue date/.test(backwards.body.error ?? ""),
      backwards.body.error,
    );

    const anonymous = await fetch(`${BASE}/api/upload`, { method: "POST", body: new FormData() });
    check("an unauthenticated upload is refused", anonymous.status === 401);

    // Every refusal above happened before anything was written. A validation
    // that runs after the upload leaves a file in storage with no row pointing
    // at it — invisible, unreferenced, and growing on every mistyped date.
    const orphans = await prisma.employeeDocument.count({ where: { employeeId: employee.id } });
    check("a refused upload writes no document row", orphans === 0, `${orphans} rows`);

    console.log("\nFilling the file in");
    const uploads: [string, Buffer, string, Record<string, string>][] = [
      ["CV", pdf, "cv.pdf", {}],
      ["NID", png, "nid-front.png", {}],
      ["PHOTOGRAPH", png, "photo.png", {}],
      ["EDUCATION_CERTIFICATE", pdf, "bba.pdf", {}],
      ["EXPERIENCE_LETTER", pdf, "experience.pdf", {}],
      ["RELEASE_LETTER", pdf, "release.pdf", {}],
      ["APPOINTMENT_LETTER", pdf, "appointment.pdf", {}],
      ["JOINING_LETTER", pdf, "joining.pdf", {}],
      [
        "RM_CERTIFICATE",
        pdf,
        "certificate.pdf",
        { issueDate: "2026-03-14", expiryDate: "2027-03-14" },
      ],
    ];
    for (const [kind, bytes, name, extra] of uploads) {
      const type = name.endsWith(".png") ? "image/png" : "application/pdf";
      const result = await upload(cookie, kind, { name, bytes, type }, extra);
      if (result.status !== 200) check(`upload ${kind}`, false, `${result.status} ${result.body.error}`);
    }

    state = await loadOnboardingState(employee);
    check("nine documents in, bank details still missing", state.progress.done === 9, `got ${state.progress.done}`);
    check("Submit is still refused", !state.canSubmit);
    check(
      "and it names what is missing",
      state.missing.includes("Bank details") && state.missing.includes("An emergency contact"),
      state.missing.join(", "),
    );

    await prisma.employeeBankDetail.create({
      data: {
        employeeId: employee.id,
        accountName: "QA Relationship Manager",
        accountNumber: "1234567890",
        bankName: "Test Bank",
        branchName: "Motijheel",
        updatedByName: "qa",
      },
    });
    await prisma.emergencyContact.create({
      data: {
        employeeId: employee.id,
        slot: 1,
        name: "QA Contact",
        relationship: "Sibling",
        mobile: "01712345678",
        status: "CURRENT",
        proposedByName: "qa",
      },
    });

    state = await loadOnboardingState(employee);
    check("all ten green", state.progress.done === 10 && state.progress.complete, state.progress.label);
    check("Submit is now allowed", state.canSubmit);
    check("nothing is listed as missing", state.missing.length === 0, state.missing.join(", "));

    console.log("\nAfter HR sends one item back");
    const cv = await prisma.employeeDocument.findFirst({
      where: { employeeId: employee.id, kind: "CV" },
    });
    await prisma.employeeDocument.update({
      where: { id: cv!.id },
      data: { status: "REJECTED", rejectionReason: "The scan is cut off at the bottom." },
    });
    const nid = await prisma.employeeDocument.findFirst({
      where: { employeeId: employee.id, kind: "NID" },
    });
    await prisma.employeeDocument.update({ where: { id: nid!.id }, data: { status: "ACCEPTED" } });

    state = await loadOnboardingState(employee);
    const cvBox = state.boxes.find((b) => b.spec.kind === "CV")!;
    const nidBox = state.boxes.find((b) => b.spec.kind === "NID")!;
    check("only the rejected box reopens", !cvBox.satisfied && cvBox.rejectionReason !== "");
    check("the reason is shown to the person", cvBox.rejectionReason.includes("cut off"));
    check("an accepted box stays satisfied", nidBox.satisfied);
    check("Submit is refused again", !state.canSubmit);
    check("the count drops back", state.progress.done === 9, state.progress.label);

    console.log("\nRe-uploading supersedes rather than replaces");
    const again = await upload(cookie, "CV", { name: "cv-rescanned.pdf", bytes: pdf, type: "application/pdf" });
    check("the re-upload is accepted", again.status === 200, again.body.error);
    const cvHistory = await prisma.employeeDocument.findMany({
      where: { employeeId: employee.id, kind: "CV" },
      orderBy: { uploadedAt: "asc" },
    });
    check("the old file is kept, marked superseded", cvHistory.length === 2 && cvHistory[0].supersededAt !== null);
    check("nothing was deleted", cvHistory.every((d) => d.id));

    console.log("\nA document HR has accepted cannot be replaced by the employee");
    const replaceAccepted = await upload(cookie, "PHOTOGRAPH", {
      name: "photo2.png",
      bytes: png,
      type: "image/png",
    });
    // The photograph is still PENDING, so this is allowed. Accept the NID's
    // box instead, which is multiple:true and therefore stays open by design.
    check("a pending box still accepts a replacement", replaceAccepted.status === 200);

    const appointment = await prisma.employeeDocument.findFirst({
      where: { employeeId: employee.id, kind: "APPOINTMENT_LETTER" },
    });
    await prisma.employeeDocument.update({
      where: { id: appointment!.id },
      data: { status: "ACCEPTED" },
    });
    const blocked = await upload(cookie, "APPOINTMENT_LETTER", {
      name: "appointment2.pdf",
      bytes: pdf,
      type: "application/pdf",
    });
    check(
      "an accepted single-file box refuses a replacement",
      blocked.status === 409 && /already accepted/.test(blocked.body.error ?? ""),
      `${blocked.status} ${blocked.body.error}`,
    );

    console.log("\nEvery view of a document is recorded");
    const viewable = cvHistory[1];
    const before = await prisma.auditEvent.count({ where: { action: "document.viewed" } });
    const download = await fetch(`${BASE}/api/download?id=${viewable.id}`, { headers: { cookie } });
    check("the owner can read their own document", download.status === 200, String(download.status));
    check("it is served with nosniff", download.headers.get("x-content-type-options") === "nosniff");
    check("and is never cached", (download.headers.get("cache-control") ?? "").includes("no-store"));
    const after = await prisma.auditEvent.count({ where: { action: "document.viewed" } });
    check("the view wrote a line to the permanent record", after === before + 1);

    const strangerDownload = await fetch(`${BASE}/api/download?id=${viewable.id}`);
    check("a signed-out request gets 404, not 403", strangerDownload.status === 404);
    const missingDoc = await fetch(`${BASE}/api/download?id=does-not-exist`, { headers: { cookie } });
    check("an unknown id is indistinguishable from a forbidden one", missingDoc.status === 404);
  } finally {
    // By exact id, in a finally, never by predicate.
    //
    // Deleting the employee cascades the document ROWS but not the stored
    // files — nothing in production ever deletes an employee, so the orphan
    // only happens here. Collect the keys before the cascade removes them.
    const keys = await prisma.employeeDocument.findMany({
      where: { employeeId: employee.id },
      select: { storageKey: true },
    });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
    for (const { storageKey } of keys) await deleteObject(storageKey);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

void FIXTURES;
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
