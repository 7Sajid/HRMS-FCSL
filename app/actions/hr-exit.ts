"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { currentIp, getSessionContext } from "@/lib/auth";
import { actorFrom, record } from "@/lib/audit";
import { notify } from "@/lib/notifications";
import { can } from "@/lib/permissions";
import { fromISODate, toISODate } from "@/lib/dates";
import { CLEARANCE_CHECKLIST, exitBlockers, purgeDateFor, releaseLetterTemplate } from "@/lib/exit";
import { releaseLetterPdf } from "@/lib/pdf";
import { documentKey, putObject } from "@/lib/storage";
import { safeFileName } from "@/lib/uploads";
import { formatDate, todayInDhaka } from "@/lib/dates";

export type ExitResult = { ok: true } | { error: string };

const schema = z.object({
  reason: z.enum(["RESIGNATION", "END_OF_CONTRACT", "TERMINATION", "RETIREMENT"]),
  lastWorkingDay: z.string().trim().min(1, "Set their last working day."),
  reasonNote: z.string().trim().max(500).optional().default(""),
});

/**
 * Step 1 — record the departure (§6.6).
 *
 * Recording is not completing. The clearance checklist is created here and the
 * exit stays open until every line is ticked and the terminal is released.
 */
export async function recordExit(
  employeeId: string,
  _previous: unknown,
  formData: FormData,
): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot record a leaver." };

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]!.message };

  const lastWorkingDay = fromISODate(parsed.data.lastWorkingDay);
  if (!lastWorkingDay) return { error: "That is not a date." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { exit: true },
  });
  if (!employee) return { error: "Not found." };
  // A REVERSED exit is not an exit. Somebody who withdrew a resignation in
  // March and genuinely leaves in September needs this to work; the reversed
  // one lives on in the permanent record, which is where rule 8's guarantee
  // actually sits.
  if (employee.exit && !employee.exit.reversedAt) {
    return { error: "An exit is already recorded for this person." };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    await tx.exit.upsert({
      where: { employeeId },
      update: {
        reason: parsed.data.reason,
        reasonNote: parsed.data.reasonNote,
        lastWorkingDay,
        recordedById: context.user.id,
        recordedByName: actorName,
        recordedAt: new Date(),
        completedAt: null,
        completedById: null,
        completedByName: "",
        reversedAt: null,
        reversedById: null,
        reversedByName: "",
        reversalReason: "",
        documentsPurgeAfter: purgeDateFor(lastWorkingDay),
        clearanceItems: {
          deleteMany: {},
          create: CLEARANCE_CHECKLIST.map((item) => ({ ...item })),
        },
      },
      create: {
        employeeId,
        reason: parsed.data.reason,
        reasonNote: parsed.data.reasonNote,
        lastWorkingDay,
        recordedById: context.user.id,
        recordedByName: actorName,
        // §12.2: one year after the last working day the FILES go; the record
        // stays permanently so headcount reports remain correct.
        documentsPurgeAfter: purgeDateFor(lastWorkingDay),
        clearanceItems: { create: CLEARANCE_CHECKLIST.map((item) => ({ ...item })) },
      },
    });

    await tx.employee.update({ where: { id: employeeId }, data: { lastWorkingDay } });

    await record({
      action: "exit.recorded",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: {
        reason: parsed.data.reason,
        lastWorkingDay: parsed.data.lastWorkingDay,
        note: parsed.data.reasonNote || undefined,
      },
      ip,
      tx,
    });

    // §8: HR Head, their manager, and IT and Accounts for clearance.
    const toTell = await tx.user.findMany({
      where: { role: { in: ["HR_HEAD", "HR_EXECUTIVE"] }, disabledAt: null },
      select: { id: true },
    });
    await notify(
      toTell.map((u) => ({
        userId: u.id,
        title: `${employee.fullName} is leaving`,
        body: `Last working day ${parsed.data.lastWorkingDay}. Clearance has been opened.`,
        link: `/hr/exits/${employeeId}`,
      })),
      tx,
    );
  });

  revalidatePath("/hr/exits");
  return { ok: true };
}

/** Step 2 — each line ticked off by the department responsible. */
export async function clearItem(itemId: string, note: string): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot do that." };

  const item = await prisma.clearanceItem.findUnique({
    where: { id: itemId },
    include: { exit: { include: { employee: true } } },
  });
  if (!item) return { error: "Not found." };
  if (item.exit.completedAt) return { error: "This exit is already finished." };

  const actorName = context.employee?.fullName ?? context.user.email;

  await prisma.$transaction(async (tx) => {
    await tx.clearanceItem.update({
      where: { id: itemId },
      data: {
        clearedById: item.clearedAt ? null : context.user.id,
        clearedByName: item.clearedAt ? "" : actorName,
        clearedAt: item.clearedAt ? null : new Date(),
        note: note.trim().slice(0, 300),
      },
    });
    await record({
      action: "exit.clearance_cleared",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: item.exit.employeeId,
      targetLabel: item.exit.employee.fullName,
      detail: { item: item.label, cleared: !item.clearedAt },
      ip: await currentIp(),
      tx,
    });
  });

  revalidatePath(`/hr/exits/${item.exit.employeeId}`);
  return { ok: true };
}

/**
 * Steps 3 to 6 — finish the exit (§6.6).
 *
 * Releases the certificate and marks the ID Left. Refuses outright while a
 * terminal is still assigned: a person who has left holding a live trading
 * terminal is exactly what a BSEC inspection asks about, and a warning that
 * can be clicked past is not a safeguard.
 */
export async function completeExit(employeeId: string): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot do that." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      exit: { include: { clearanceItems: true } },
      terminalAssignments: { where: { releasedOn: null }, include: { terminal: true } },
      certificates: { where: { status: "ACTIVE" } },
    },
  });
  if (!employee?.exit) return { error: "No exit is recorded for this person." };
  if (employee.exit.completedAt) return { error: "This exit is already finished." };

  const blockers = exitBlockers({
    openTerminals: employee.terminalAssignments.length,
    unclearedItems: employee.exit.clearanceItems.filter((i) => !i.clearedAt).length,
  });
  if (blockers.length) return { error: blockers.join(" ") };

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();

  await prisma.$transaction(async (tx) => {
    // The certificate is surrendered, so they drop out of the expiry register.
    for (const certificate of employee.certificates) {
      await tx.rmCertificate.update({
        where: { id: certificate.id },
        data: { status: "SURRENDERED", surrenderedOn: employee.exit!.lastWorkingDay },
      });
    }

    await tx.employee.update({
      where: { id: employeeId },
      // Marked LEFT, never deleted. This is what makes the active-versus-left
      // headcount answerable at any moment in time (§6.6).
      data: { status: "LEFT" },
    });

    // Access closes at the end of the last working day. If that day has
    // already passed, it closes now rather than waiting for a nightly job.
    const closesAt = employee.exit!.lastWorkingDay;
    if (closesAt <= new Date()) {
      await tx.user.update({ where: { id: employee.userId }, data: { disabledAt: new Date() } });
      await tx.session.updateMany({
        where: { userId: employee.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await tx.exit.update({
      where: { employeeId },
      data: {
        completedAt: new Date(),
        completedById: context.user.id,
        completedByName: actorName,
      },
    });

    const actor = actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role });
    await record({
      action: "exit.completed",
      actor,
      targetType: "employee",
      targetId: employeeId,
      targetLabel: employee.fullName,
      detail: {
        lastWorkingDay: employee.exit!.lastWorkingDay.toISOString().slice(0, 10),
        certificatesSurrendered: employee.certificates.length,
        accessClosed: closesAt <= new Date(),
      },
      ip,
      tx,
    });
    await record({
      action: "employee.marked_left",
      actor,
      targetType: "employee",
      targetId: employeeId,
      targetLabel: `${employee.fullName} — ${employee.employeeId ?? "no ID"}`,
      detail: { lastWorkingDay: employee.exit!.lastWorkingDay.toISOString().slice(0, 10) },
      ip,
      tx,
    });
  });

  revalidatePath("/hr/exits");
  revalidatePath(`/hr/exits/${employeeId}`);
  revalidatePath("/hr/employees");
  return { ok: true };
}

/**
 * Undo an exit (§6.6).
 *
 * A resignation withdrawn, or an exit recorded against the wrong person. Until
 * this existed there was no way back at all: `lib/accounts.ts` refused to
 * re-enable the account with "Reverse the exit first" and the software offered
 * no means of doing so, so a typo needed somebody in the database.
 *
 * HR undoes the RECORD; the account stays closed until the Super Admin opens
 * it, because §5.5 gives activating an account to them alone. That is why this
 * does not touch `disabledAt` — and why `enableAccountAs` now succeeds, since
 * it refuses only while the person is still marked LEFT.
 */
export async function reverseExit(employeeId: string, reason: string): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot do that." };

  const written = reason.trim().slice(0, 500);
  // §6 everywhere: anything a person is told, they are told the reason for.
  // This one is read by whoever asks why somebody left and then did not.
  if (written.length < 5) {
    return { error: "Say why the exit is being undone. This stays on the record." };
  }

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { exit: true, certificates: { where: { status: "SURRENDERED" } } },
  });
  if (!employee?.exit) return { error: "No exit is recorded for this person." };
  if (employee.exit.reversedAt) return { error: "This exit has already been undone." };
  if (employee.exit.documentsPurgedAt) {
    // §12.2 removed the files a year after the last working day. Putting the
    // person back would leave an employee file that cannot be completed, and
    // pretending otherwise is worse than refusing.
    return {
      error:
        "Their documents were removed under the one-year retention rule. This exit can no longer be undone — create a new file.",
    };
  }

  const actorName = context.employee?.fullName ?? context.user.email;
  const ip = await currentIp();
  const lastWorkingDay = employee.exit.lastWorkingDay;

  await prisma.$transaction(async (tx) => {
    await tx.exit.update({
      where: { employeeId },
      data: {
        reversedAt: new Date(),
        reversedById: context.user.id,
        reversedByName: actorName,
        reversalReason: written,
      },
    });

    await tx.employee.update({
      where: { id: employeeId },
      data: { status: "ACTIVE", lastWorkingDay: null },
    });

    // The certificate was surrendered when the exit completed, which dropped
    // them out of the expiry register. An Associate coming back with no certificate
    // is an Associate nobody is watching.
    for (const certificate of employee.certificates) {
      if (certificate.surrenderedOn?.getTime() !== lastWorkingDay.getTime()) continue;
      await tx.rmCertificate.update({
        where: { id: certificate.id },
        data: { status: "ACTIVE", surrenderedOn: null },
      });
    }

    await record({
      action: "exit.reversed",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: `${employee.fullName} — ${employee.employeeId ?? "no ID"}`,
      detail: {
        reason: written,
        lastWorkingDay: toISODate(lastWorkingDay),
        exitReason: employee.exit!.reason,
        wasCompleted: employee.exit!.completedAt !== null,
        certificatesRestored: employee.certificates.length,
        // Said explicitly, because it is the next thing somebody has to do.
        accountStillClosed: true,
      },
      ip,
      tx,
    });
  });

  revalidatePath("/hr/exits");
  revalidatePath(`/hr/exits/${employeeId}`);
  revalidatePath("/admin/accounts");
  return { ok: true };
}

/**
 * §6.6 step 5 — the release letter, produced and filed.
 *
 * The spec asks for it "produced from a template and stored in the person's
 * file". Nothing produced one: `Exit.releaseLetterDocumentId` sat unwritten
 * and the clearance list carried a "Release letter prepared" tick-box that a
 * person satisfied outside the system, which meant the letter never reached
 * the file an auditor would look in.
 *
 * The body comes from the screen, not from here — `releaseLetterTemplate`
 * drafts it and HR edits it first, because the wording is FCSL's to own.
 *
 * Same order as the show-cause reply: the object is written before the rows
 * that point at it, so a failure leaves an unreferenced file in the bucket
 * rather than a record claiming a document that is not there.
 */
export async function issueReleaseLetter(employeeId: string, body: string): Promise<ExitResult> {
  const context = await getSessionContext();
  if (!context) return { error: "Please sign in again." };
  if (!can(context.viewer, "exits.record")) return { error: "You cannot do that." };

  const written = body.trim();
  if (written.length < 40) return { error: "The letter is too short. Check the wording." };

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { exit: true, designation: true },
  });
  if (!employee?.exit) return { error: "No exit is recorded for this person." };
  if (employee.exit.reversedAt) return { error: "This exit has been undone." };

  const actorName = context.employee?.fullName ?? context.user.email;
  const issuedOn = todayInDhaka();

  const bytes = await releaseLetterPdf({
    employeeName: employee.fullName,
    employeeCode: employee.employeeId,
    designation: employee.designation?.name ?? null,
    joiningDate: employee.joiningDate ? formatDate(employee.joiningDate) : "—",
    lastWorkingDay: formatDate(employee.exit.lastWorkingDay),
    body: written.slice(0, 8000),
    issuedByName: actorName,
    issuedOn: formatDate(issuedOn),
  });
  const name = safeFileName(`Release letter ${formatDate(issuedOn)}`, "application/pdf");
  const key = documentKey(employee.id, "EXIT_RELEASE_LETTER", "release.pdf");
  await putObject(key, bytes, "application/pdf");

  const ip = await currentIp();
  await prisma.$transaction(async (tx) => {
    const document = await tx.employeeDocument.create({
      data: {
        employeeId: employee.id,
        kind: "EXIT_RELEASE_LETTER",
        storageKey: key,
        originalName: name,
        mimeType: "application/pdf",
        size: bytes.length,
        // Nothing to review: the system made it from what HR wrote.
        status: "ACCEPTED",
        uploadedById: context.user.id,
        uploadedByName: `${actorName} (generated by the system)`,
        reviewedByName: "Generated by the system",
        reviewedAt: new Date(),
      },
    });
    // Superseded, never replaced: a reissued letter leaves the first one in
    // the file, because somebody may already be holding a copy of it.
    await tx.exit.update({
      where: { employeeId },
      data: { releaseLetterDocumentId: document.id },
    });
    await record({
      action: "exit.release_letter_issued",
      actor: actorFrom({ id: context.user.id, fullName: actorName, role: context.user.role }),
      targetType: "employee",
      targetId: employeeId,
      targetLabel: `${employee.fullName} — ${employee.employeeId ?? "no ID"}`,
      detail: { documentId: document.id, lastWorkingDay: toISODate(employee.exit!.lastWorkingDay) },
      ip,
      tx,
    });
  });

  revalidatePath(`/hr/exits/${employeeId}`);
  return { ok: true };
}
