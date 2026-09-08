import { NextResponse } from "next/server";
import type { DocumentKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionContext, currentIp } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { documentSpec } from "@/lib/documents";
import { checkUpload, safeFileName } from "@/lib/uploads";
import { BURST, isRateLimited, recordAttempt } from "@/lib/rate-limit";
import { compressUpload, PORTRAIT_EDGE, savingLine } from "@/lib/images";
import { documentKey, putObject } from "@/lib/storage";
import { fromISODate } from "@/lib/dates";

/**
 * The one multipart endpoint. A Server Action cannot stream a file, so uploads
 * are a route handler and everything else in the system is an action.
 *
 * Runs long enough for a phone on a branch connection to finish sending a
 * ten-megabyte scan.
 */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  const context = await getSessionContext();
  if (!context?.employee) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const employee = context.employee;

  // Keyed on the person rather than the address, because a branch office sits
  // behind one NAT and limiting that would throttle a room full of new joiners
  // uploading on the same morning. Counted before the body is read, so a flood
  // costs an index scan rather than ten megabytes of transfer and a resize.
  //
  // A brake, not a wall — everyone who reaches it is signed in and audited.
  const limitKey = `upload:${context.user.id}`;
  if (await isRateLimited(limitKey, BURST)) {
    return NextResponse.json(
      { error: "That is a great many uploads at once. Wait a few minutes and try again." },
      { status: 429 },
    );
  }
  await recordAttempt(limitKey);

  const form = await request.formData();
  const kind = String(form.get("kind") ?? "") as DocumentKind;
  const file = form.get("file");
  const label = String(form.get("label") ?? "").trim().slice(0, 120);

  const spec = documentSpec(kind);
  if (!spec || spec.isForm) {
    return NextResponse.json({ error: "That is not a document this system takes." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file was received." }, { status: 400 });
  }

  // A person uploads to their own file and nowhere else. There is no employee
  // id in this request on purpose — accepting one would make it a parameter
  // somebody could change.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkUpload(bytes, spec.accepts, file.name);
  if (!checked.ok) return NextResponse.json({ error: checked.message }, { status: 400 });

  // §5.1 page 2: an employee "cannot replace or delete a document HR has
  // already accepted". A box that holds one accepted file is closed.
  if (!spec.multiple) {
    const accepted = await prisma.employeeDocument.count({
      where: { employeeId: employee.id, kind, status: "ACCEPTED", supersededAt: null },
    });
    if (accepted > 0) {
      return NextResponse.json(
        { error: "HR has already accepted this one. Ask HR if it needs replacing." },
        { status: 409 },
      );
    }
  }

  // The RM certificate carries its two dates (§4 step 3). They drive the
  // four-month warning, so they are captured with the file, not later.
  //
  // Checked BEFORE anything is written. Validating after the upload leaves a
  // file in storage with no row pointing at it every time somebody forgets a
  // date — invisible, unreferenced, and growing.
  const issueDate = spec.capturesDates ? fromISODate(String(form.get("issueDate") ?? "")) : null;
  const expiryDate = spec.capturesDates ? fromISODate(String(form.get("expiryDate") ?? "")) : null;
  if (spec.capturesDates && (!issueDate || !expiryDate)) {
    return NextResponse.json(
      { error: "Enter the certificate's issue date and expiry date." },
      { status: 400 },
    );
  }
  if (issueDate && expiryDate && expiryDate <= issueDate) {
    return NextResponse.json(
      { error: "The expiry date must be after the issue date." },
      { status: 400 },
    );
  }

  // Shrunk before anything is written. A phone photograph of a national ID
  // arrives at six or eight megabytes and reads identically at three hundred
  // kilobytes; over four hundred staff that is the difference between a few
  // gigabytes of storage and a hundred. PDFs pass through untouched, and an
  // image that cannot be read or would only get bigger is kept exactly as it
  // came — see lib/images.ts.
  const shrunk = await compressUpload(
    bytes,
    checked.type,
    // A passport photograph is a face in a box; it needs nothing like a page.
    kind === "PHOTOGRAPH" ? PORTRAIT_EDGE : undefined,
  );

  const key = documentKey(employee.id, kind, `x.${shrunk.type === "application/pdf" ? "pdf" : "jpg"}`);
  // The name and the extension follow what was actually STORED, not what was
  // sent: a PNG that came out as a JPEG must not be filed as cv.png, or it
  // fails to open on somebody's desk later.
  const storedName = safeFileName(file.name, shrunk.type);

  // Every refusal is now behind us, so the file can be written. Storage before
  // the row, deliberately: a row pointing at a file that was never written is
  // worse than a file with no row, because the row is what HR is told to
  // review and the file is what they would find missing.
  await putObject(key, shrunk.bytes, shrunk.type);

  const ip = await currentIp();
  const document = await prisma.$transaction(async (tx) => {
    // Re-uploading after a send-back supersedes the rejected file rather than
    // replacing it. Nothing is ever deleted (§6.1).
    await tx.employeeDocument.updateMany({
      where: { employeeId: employee.id, kind, status: "REJECTED", supersededAt: null },
      data: { supersededAt: new Date(), supersedeReason: "Re-uploaded after being sent back" },
    });

    const created = await tx.employeeDocument.create({
      data: {
        employeeId: employee.id,
        kind,
        label,
        storageKey: key,
        originalName: storedName,
        mimeType: shrunk.type,
        size: shrunk.bytes.length,
        status: "PENDING",
        issueDate,
        expiryDate,
        uploadedById: context.user.id,
        uploadedByName: employee.fullName,
      },
    });

    await record({
      action: "document.uploaded",
      actor: actorFrom({ ...context.user, fullName: employee.fullName }),
      targetType: "employee",
      targetId: employee.id,
      targetLabel: employee.fullName,
      detail: {
        kind,
        fileName: storedName,
        size: shrunk.bytes.length,
        // Written down because somebody will one day ask why the file in the
        // record is smaller than the one they remember sending.
        ...(shrunk.changed
          ? { compressed: savingLine(shrunk.originalSize, shrunk.bytes.length) }
          : {}),
      },
      ip,
      tx,
    });

    return created;
  });

  return NextResponse.json({
    ok: true,
    id: document.id,
    name: storedName,
    size: shrunk.bytes.length,
    saved: shrunk.changed ? savingLine(shrunk.originalSize, shrunk.bytes.length) : null,
  });
}
