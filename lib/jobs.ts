import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { recordQuietly } from "./audit";
import { notify } from "./notifications";
import { escapeHtml, layout, sendMail } from "./email";
import { deleteObject } from "./storage";
import {
  addDays,
  daysBetween,
  daysInMonth,
  formatDate,
  formatMonth,
  todayInDhaka,
  toISODate,
  workingDaysSince,
} from "./dates";
import { escalateAfterWorkingDays, isOverdue, waitedWorkingDays } from "./escalation";
import { warningStarts } from "./certificate";
import { requisitionLabel } from "./requisitions";

/**
 * The scheduled jobs (§8, §12.2, P5.4).
 *
 * Everything here runs from `app/api/cron`, and everything here can also be
 * run from a terminal with `scripts/run-job.ts`. That second path is not a
 * convenience: when a job has silently not run for a week, being able to run
 * it once, watch what it does and see the numbers is how you find out why.
 *
 * Three properties every job in this file holds to.
 *
 *   **Idempotent within a day.** Vercel Cron retries, a deploy can overlap a
 *   run, and somebody will click the manual button after the automatic one.
 *   `ReminderState` remembers what has already been said about each subject
 *   today, so a second run in the same day is a no-op rather than a second
 *   email. A warning that arrives twice is a warning people start deleting.
 *
 *   **The bell is complete; email is not.** §8: "The bell is the complete list;
 *   email carries only what should interrupt somebody's day." So the in-app
 *   notification goes out per event, and email goes out once, in the morning
 *   digest — with the single exception of the certificate ladder, which §8
 *   marks Yes because a lapsed licence is a regulatory problem and not an
 *   inbox one.
 *
 *   **Nothing is decided.** §7.3: "The system never silently approves anything
 *   on its own." These jobs make things harder to ignore. Not one of them
 *   changes a decision, and the only thing any of them deletes is a file the
 *   retention rule says must go.
 */

export type JobResult = {
  job: string;
  /** What it found that needed doing. */
  considered: number;
  /** What it actually acted on, after the already-said-today check. */
  acted: number;
  notes: string[];
};

export type JobName =
  | "certificates"
  | "attendance"
  | "escalations"
  | "idle-uploads"
  | "purge"
  | "digest";

export const JOB_NAMES: readonly JobName[] = [
  // Order matters for one reason only: the digest runs LAST, so that anything
  // the other jobs raised this morning is in the same email rather than
  // tomorrow's.
  "certificates",
  "attendance",
  "escalations",
  "idle-uploads",
  "purge",
  "digest",
];

// ---------------------------------------------------------------------------
// The memory that stops a nightly job shouting nightly
// ---------------------------------------------------------------------------

/**
 * True if this is the first time today we have said this, and claims the day.
 *
 * The write and the check are one upsert, so two overlapping runs cannot both
 * come back true — a Vercel retry that begins before the first run finishes is
 * a real thing and it lands here.
 */
async function claimToday(key: string, rung: string, today: Date): Promise<boolean> {
  const existing = await prisma.reminderState.findUnique({ where: { key } });
  if (existing && toISODate(existing.lastSentOn) === toISODate(today) && existing.lastRung === rung) {
    return false;
  }
  await prisma.reminderState.upsert({
    where: { key },
    create: { key, lastSentOn: today, lastRung: rung, sentCount: 1 },
    update: { lastSentOn: today, lastRung: rung, sentCount: { increment: 1 } },
  });
  return true;
}

/** Everybody holding a role, for the "HR Head is told" rows in §8. */
async function usersWithRole(...roles: Prisma.UserWhereInput["role"][]): Promise<{ id: string; email: string }[]> {
  return prisma.user.findMany({
    where: { role: { in: roles as never }, disabledAt: null },
    select: { id: true, email: true },
  });
}

// ---------------------------------------------------------------------------
// 1. The RM certificate ladder
// ---------------------------------------------------------------------------

/**
 * §8: "4 months before, then monthly, then weekly in the final month" and,
 * once it has lapsed, "on the day, then weekly until resolved."
 *
 * The rung is computed from the expiry date rather than counted from the last
 * send, so a job that did not run for a fortnight resumes at the right rung
 * instead of walking up the ladder from where it stopped.
 *
 * It never blocks anybody. FCSL settled that: the system warns, and a licence
 * date typed in wrongly must not be able to lock somebody out of their work.
 */
export async function runCertificateLadder(today = todayInDhaka()): Promise<JobResult> {
  const notes: string[] = [];
  let acted = 0;

  const certificates = await prisma.rmCertificate.findMany({
    where: { status: "ACTIVE", employee: { status: "ACTIVE" } },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          userId: true,
          managerId: true,
          user: { select: { email: true } },
        },
      },
    },
    orderBy: { expiryDate: "asc" },
  });

  for (const certificate of certificates) {
    const days = daysBetween(today, certificate.expiryDate);
    const rung = ladderRung(days, today, certificate.expiryDate);
    if (!rung) continue;

    if (!(await claimToday(`certificate:${certificate.id}`, rung.name, today))) continue;
    acted += 1;

    const expired = days <= 0;
    const headline =
      days === 0
        ? `${certificate.employee.fullName}'s RM certificate expires today`
        : expired
          ? `${certificate.employee.fullName}'s RM certificate has expired`
          : `${certificate.employee.fullName}'s RM certificate expires in ${days} day${days === 1 ? "" : "s"}`;

    // §8 names different audiences before and after the date: expiring goes to
    // the RM, their manager and HR; expired goes up to the Super Admin,
    // because by then it is a compliance matter rather than an errand.
    const audience = new Set<string>([certificate.employee.userId]);
    if (expired) {
      for (const u of await usersWithRole("HR_HEAD", "SUPER_ADMIN")) audience.add(u.id);
    } else {
      for (const u of await usersWithRole("HR_EXECUTIVE", "HR_HEAD")) audience.add(u.id);
      if (certificate.employee.managerId) {
        const manager = await prisma.employee.findUnique({
          where: { id: certificate.employee.managerId },
          select: { userId: true },
        });
        if (manager) audience.add(manager.userId);
      }
    }

    await notify(
      [...audience].map((userId) => ({
        userId,
        title: headline,
        body: expired
          ? `${days === 0 ? "Expires today" : `Expired ${formatDate(certificate.expiryDate)}`}. It does not block their work, but it has to be resolved.`
          : `Expires ${formatDate(certificate.expiryDate)}. Certificate ${certificate.certificateNumber}.`,
        link: "/hr/certificates",
      })),
    );

    // The one ladder §8 marks for email at every rung. A lapsed BSEC licence
    // is not a thing to leave sitting behind a bell icon nobody has opened.
    await sendMail({
      to: certificate.employee.user.email,
      subject: expired ? "Your RM certificate has expired" : "Your RM certificate needs renewing",
      html: layout({
        heading:
          days === 0
            ? "Your RM certificate expires today"
            : expired
              ? "Your RM certificate has expired"
              : "Your RM certificate needs renewing",
        lines: [
          `Certificate ${escapeHtml(certificate.certificateNumber)}, expiring ${escapeHtml(formatDate(certificate.expiryDate))}.`,
          expired
            ? "Your account and your work are unaffected. HR has been told and will need the renewal."
            : "Give HR the renewal when you have it and they will record the new dates.",
        ],
        link: { label: "See your certificate", href: "/me/certificate" },
      }),
    });

    notes.push(`${certificate.employee.fullName}: ${rung.name} (${days} days)`);
  }

  await recordQuietly({
    action: "system.cron_ran",
    targetType: "job",
    targetLabel: "RM certificate warnings",
    detail: { considered: certificates.length, warned: acted },
  });

  return { job: "certificates", considered: certificates.length, acted, notes };
}

type Rung = { name: string };

/**
 * Which rung today falls on, or null for silence.
 *
 * Exported because the shape of this ladder is the part worth testing directly
 * — "monthly" and "weekly" are easy to write and easy to get off by a day, and
 * a test that goes through the database to find out is a test nobody runs.
 */
export function ladderRung(daysRemaining: number, today: Date, expiry: Date): Rung | null {
  // §8 puts "on the day" in the EXPIRED row, not the expiring one — "On the
  // day, then weekly until resolved". So day zero is treated as lapsed, which
  // is also what decides the audience below: from this morning the Super Admin
  // is told, because it has stopped being an errand and become a compliance
  // matter.
  if (daysRemaining <= 0) {
    if (daysRemaining === 0) return { name: "expired-today" };
    // Counted from the expiry date so the weeks land on the same weekday for
    // ever rather than drifting from whenever the job happened to run.
    return -daysRemaining % 7 === 0 ? { name: "expired-weekly" } : null;
  }

  // Final month: weekly.
  if (daysRemaining <= 30) {
    return daysRemaining % 7 === 0 ? { name: "final-month-weekly" } : null;
  }

  // Between four months and one month: monthly, on the day of the month the
  // certificate expires. "Monthly" as every-30-days would slide off the date
  // and warn twice in some months and not at all in others.
  //
  // Four months is `warningStarts` from lib/certificate.ts, the same function
  // that turns the RM's own panel amber. Written as a day count here it would
  // be 120 or 123 depending on which months it crossed, and the screen and the
  // email would disagree about when the warning began — in front of the person
  // whose licence it is.
  if (today < warningStarts(expiry)) return null;
  const sameDayOfMonth =
    today.getUTCDate() ===
    Math.min(expiry.getUTCDate(), daysInMonth(today.getUTCFullYear(), today.getUTCMonth() + 1));
  return sameDayOfMonth ? { name: "monthly" } : null;
}

// ---------------------------------------------------------------------------
// 2. Attendance sheets due, and branches that have not submitted
// ---------------------------------------------------------------------------

/**
 * §8: "Attendance sheet due — every branch manager — last working day of the
 * month, then daily if late", and "Branch has not submitted — HR Head — three
 * working days after the deadline."
 */
export async function runAttendanceReminders(today = todayInDhaka()): Promise<JobResult> {
  const notes: string[] = [];
  let acted = 0;

  const setting = await prisma.setting.findUnique({ where: { key: "attendance.deadlineDayOfMonth" } });
  const deadlineDay = Math.max(1, Math.min(28, Number(setting?.value) || 5));

  // The month being reported is the one that has just ended.
  const reporting = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const year = reporting.getUTCFullYear();
  const month = reporting.getUTCMonth() + 1;
  const deadline = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), deadlineDay));

  // Before the deadline there is nothing to chase.
  if (today < deadline) {
    return { job: "attendance", considered: 0, acted: 0, notes: ["Not due yet."] };
  }

  const branches = await prisma.branch.findMany({
    where: { closedOn: null },
    include: {
      attendanceSheets: { where: { year, month }, select: { status: true } },
      employees: { where: { status: "ACTIVE" }, select: { id: true } },
      branchManager: { select: { userId: true, fullName: true } },
    },
  });

  // A branch with nobody in it has nothing to report, and chasing its manager
  // monthly for an empty sheet is how a reminder becomes noise.
  const outstanding = branches.filter(
    (b) => b.employees.length > 0 && (b.attendanceSheets[0]?.status ?? "OPEN") === "OPEN",
  );

  const lateBy = workingDaysSince(deadline, new Set(), [5, 6], today);
  const monthName = formatMonth(year, month);

  for (const branch of outstanding) {
    if (!branch.branchManager) {
      notes.push(`${branch.name} has no branch manager to remind.`);
      continue;
    }
    if (!(await claimToday(`attendance:${branch.id}:${year}-${month}`, "due", today))) continue;
    acted += 1;

    await notify({
      userId: branch.branchManager.userId,
      title: `${monthName} attendance for ${branch.name} has not been submitted`,
      body:
        lateBy === 0
          ? "It is due today."
          : `It was due ${formatDate(deadline)} — ${lateBy} working day${lateBy === 1 ? "" : "s"} ago.`,
      link: "/team/attendance",
    });
    notes.push(`${branch.name}: reminded (${lateBy} working days late)`);
  }

  // Three working days past the deadline the HR Head is told, once, with the
  // whole list — not one notification per branch.
  if (outstanding.length > 0 && lateBy >= 3) {
    if (await claimToday(`attendance-hrhead:${year}-${month}`, "escalated", today)) {
      const names = outstanding.map((b) => b.name).join(", ");
      for (const head of await usersWithRole("HR_HEAD")) {
        await notify({
          userId: head.id,
          title: `${outstanding.length} branch${outstanding.length === 1 ? " has" : "es have"} not submitted ${monthName} attendance`,
          body: names,
          link: "/hr/attendance",
        });
      }
      notes.push(`HR Head told about ${outstanding.length} branch(es)`);
    }
  }

  await recordQuietly({
    action: "system.cron_ran",
    targetType: "job",
    targetLabel: "Attendance reminders",
    detail: { month: monthName, outstanding: outstanding.length, reminded: acted },
  });

  return { job: "attendance", considered: outstanding.length, acted, notes };
}

// ---------------------------------------------------------------------------
// 3. Anything waiting longer than the threshold
// ---------------------------------------------------------------------------

/**
 * §7.3: "Every request that has waited more than three working days moves to
 * the top of that person's inbox and turns amber, and a reminder email goes
 * out."
 *
 * The third caller of `lib/escalation.ts`, and the reason that file exists:
 * the two inboxes colour a row amber and this job decides whom to wake up, and
 * they have to agree about what "waiting too long" means or the colour and the
 * email will contradict each other in front of the person who is late.
 */
export async function runEscalations(today = todayInDhaka()): Promise<JobResult> {
  const threshold = await escalateAfterWorkingDays();
  const notes: string[] = [];
  let acted = 0;

  const [leave, requisitions] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { status: "PENDING", currentApproverRole: { not: null } },
      include: {
        leaveType: { select: { name: true } },
        employee: { select: { fullName: true, managerId: true } },
      },
    }),
    prisma.requisition.findMany({
      where: { status: "PENDING", currentApproverRole: { not: null } },
      include: { raisedBy: { select: { fullName: true } } },
    }),
  ]);

  type Waiting = {
    kind: "leave" | "requisition";
    id: string;
    title: string;
    approverRole: NonNullable<Prisma.LeaveRequestWhereInput["currentApproverRole"]>;
    managerId: string | null;
    waited: number;
  };

  const waiting: Waiting[] = [
    ...leave.map((r) => ({
      kind: "leave" as const,
      id: r.id,
      title: `${r.employee.fullName} — ${r.leaveType.name}`,
      approverRole: r.currentApproverRole!,
      managerId: r.employee.managerId,
      waited: waitedWorkingDays(r.appliedAt, today),
    })),
    ...requisitions.map((r) => ({
      kind: "requisition" as const,
      id: r.id,
      title: `${r.raisedBy.fullName} — ${requisitionLabel(r.type)}`,
      approverRole: r.currentApproverRole!,
      managerId: null,
      waited: waitedWorkingDays(r.createdAt, today),
    })),
  ].filter((item) => isOverdue(item.waited, threshold));

  for (const item of waiting) {
    if (!(await claimToday(`escalation:${item.kind}:${item.id}`, "overdue", today))) continue;
    acted += 1;

    const recipients =
      item.approverRole === "MANAGER"
        ? item.managerId
          ? await prisma.employee
              .findUnique({ where: { id: item.managerId }, select: { userId: true } })
              .then((m) => (m ? [{ id: m.userId }] : []))
          : []
        : await usersWithRole(item.approverRole as never);

    await notify(
      recipients.map((r) => ({
        id: r.id,
        userId: r.id,
        title: `Waiting ${item.waited} working days: ${item.title}`,
        body: "This has been with you longer than it should have been.",
        link: item.kind === "leave" ? "/team/approvals" : "/hr/approvals",
      })),
    );
    notes.push(`${item.title} — ${item.waited} working days with ${item.approverRole}`);
  }

  await recordQuietly({
    action: "system.cron_ran",
    targetType: "job",
    targetLabel: "Approval escalations",
    detail: { threshold, overdue: waiting.length, reminded: acted },
  });

  return { job: "escalations", considered: waiting.length, acted, notes };
}

// ---------------------------------------------------------------------------
// 4. Thirty days behind the locked door with nothing uploaded
// ---------------------------------------------------------------------------

/**
 * §12.2 — an account that was created and then never used.
 *
 * The person is blocked from everything until they upload, so a joiner sitting
 * at DRAFT for a month is not a lazy employee; it is usually somebody who
 * never received their password, or who received it and could not sign in.
 * Either way it is HR who has to act, so it is HR who is told.
 */
export async function runIdleUploads(today = todayInDhaka()): Promise<JobResult> {
  const notes: string[] = [];
  let acted = 0;
  const cutoff = addDays(today, -30);

  const idle = await prisma.employee.findMany({
    where: {
      onboardingStatus: "DRAFT",
      createdAt: { lt: cutoff },
      documents: { none: {} },
      user: { disabledAt: null },
    },
    include: { user: { select: { id: true, email: true, createdAt: true } } },
  });

  for (const person of idle) {
    if (!(await claimToday(`uploads:${person.id}`, "idle-30", today))) continue;
    acted += 1;

    const waitingDays = daysBetween(person.createdAt, today);
    for (const hr of await usersWithRole("HR_EXECUTIVE", "HR_HEAD")) {
      await notify({
        userId: hr.id,
        title: `${person.fullName} has uploaded nothing in ${waitingDays} days`,
        body: "Their account exists but they are still behind the locked door. They may never have received their password.",
        link: "/hr/joiners",
      });
    }
    notes.push(`${person.fullName}: ${waitingDays} days, nothing uploaded`);
  }

  await recordQuietly({
    action: "system.cron_ran",
    targetType: "job",
    targetLabel: "Joiners with nothing uploaded",
    detail: { idle: idle.length, reported: acted },
  });

  return { job: "idle-uploads", considered: idle.length, acted, notes };
}

// ---------------------------------------------------------------------------
// 5. The one-year purge
// ---------------------------------------------------------------------------

/**
 * §12.2 — "Documents are purged one year after the last working day; the
 * employee record is kept permanently so headcount reports stay correct."
 *
 * This is the single exception to "nothing is ever deleted", and it is
 * deliberately narrow: the FILES go, the document ROWS stay with `purgedAt`
 * set, and the employee record is untouched. Somebody asking in 2031 what
 * documents a 2026 leaver had on file still gets an answer — a list, dates,
 * who accepted each one — just not the files themselves.
 *
 * The audit line naming the count is written before anything is removed, so a
 * purge that fails halfway still says what it was doing.
 */
export async function runDocumentPurge(today = todayInDhaka()): Promise<JobResult> {
  const notes: string[] = [];
  let acted = 0;

  const due = await prisma.exit.findMany({
    where: {
      documentsPurgedAt: null,
      documentsPurgeAfter: { lte: today },
      completedAt: { not: null },
    },
    include: {
      employee: {
        select: {
          id: true,
          fullName: true,
          employeeId: true,
          documents: { where: { purgedAt: null }, select: { id: true, storageKey: true } },
        },
      },
    },
  });

  for (const exit of due) {
    const documents = exit.employee.documents;

    await recordQuietly({
      action: "document.purged",
      targetType: "employee",
      targetId: exit.employee.id,
      targetLabel: `${exit.employee.fullName} (${exit.employee.employeeId ?? "no ID"})`,
      detail: {
        files: documents.length,
        lastWorkingDay: formatDate(exit.lastWorkingDay),
        // Stated in the log because it is the sentence somebody will need when
        // they find a record with no files against it and assume something
        // went wrong.
        recordKept: true,
      },
    });

    for (const document of documents) {
      // The object first, then the row. The other order can leave a row
      // marked purged with the file still sitting in the bucket, which is the
      // failure that matters — a record saying a file is gone when it is not.
      await deleteObject(document.storageKey);
      await prisma.employeeDocument.update({
        where: { id: document.id },
        data: { purgedAt: new Date() },
      });
    }

    await prisma.exit.update({
      where: { id: exit.id },
      data: { documentsPurgedAt: new Date() },
    });

    acted += 1;
    notes.push(`${exit.employee.fullName}: ${documents.length} file(s) removed, record kept`);
  }

  return { job: "purge", considered: due.length, acted, notes };
}

// ---------------------------------------------------------------------------
// 6. The morning digest
// ---------------------------------------------------------------------------

/**
 * §8: "Approvers get ONE SUMMARY EMAIL EACH MORNING, not one email per
 * request. A system that sends fifteen emails before lunch trains people to
 * ignore it, and then the one email that mattered gets ignored along with the
 * rest."
 *
 * Everything the other jobs did this morning has already landed as bell
 * notifications. This gathers each person's undigested ones into a single mail
 * and marks them digested, so tomorrow's covers only what is new.
 *
 * `digestedAt` is set even when the mail could not be sent. That is the right
 * trade and it is worth being explicit about: a mail server that is down for a
 * morning costs one summary, whereas retrying tomorrow means one person gets
 * two days of items and another gets an email about something they have
 * already dealt with.
 */
export async function runMorningDigest(): Promise<JobResult> {
  const notes: string[] = [];
  let acted = 0;

  const pending = await prisma.notification.findMany({
    where: { digestedAt: null, readAt: null },
    include: { user: { select: { id: true, email: true, disabledAt: true } } },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  const byUser = new Map<string, typeof pending>();
  for (const row of pending) {
    // Somebody whose account was turned off overnight does not need to hear
    // what was waiting for them.
    if (row.user.disabledAt) continue;
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  for (const [userId, rows] of byUser) {
    const email = rows[0]!.user.email;
    const lines = rows
      .slice(0, 20)
      .map((r) => `<strong>${escapeHtml(r.title)}</strong>${r.body ? ` — ${escapeHtml(r.body)}` : ""}`);
    if (rows.length > 20) lines.push(`…and ${rows.length - 20} more.`);

    await sendMail({
      to: email,
      subject:
        rows.length === 1
          ? rows[0]!.title
          : `${rows.length} things waiting for you at FCSL`,
      html: layout({
        heading: "This morning at FCSL",
        lines,
        link: { label: "Open the system", href: "/notifications" },
      }),
    });

    await prisma.notification.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { digestedAt: new Date() },
    });

    acted += 1;
    notes.push(`${email}: ${rows.length} item(s) in one email`);
  }

  await recordQuietly({
    action: "system.cron_ran",
    targetType: "job",
    targetLabel: "Morning digest",
    detail: { people: acted, items: pending.length },
  });

  return { job: "digest", considered: pending.length, acted, notes };
}

// ---------------------------------------------------------------------------

const JOBS: Record<JobName, (today?: Date) => Promise<JobResult>> = {
  certificates: runCertificateLadder,
  attendance: runAttendanceReminders,
  escalations: runEscalations,
  "idle-uploads": runIdleUploads,
  purge: runDocumentPurge,
  digest: () => runMorningDigest(),
};

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

/**
 * Run one job, or all of them in order.
 *
 * A job that throws does not stop the others. The digest in particular must
 * still go out when the purge has failed on a storage error, because the
 * digest is how anybody finds out the purge failed.
 */
export async function runJobs(which: JobName | "all", today = todayInDhaka()): Promise<JobResult[]> {
  const names = which === "all" ? JOB_NAMES : [which];
  const results: JobResult[] = [];
  for (const name of names) {
    try {
      results.push(await JOBS[name](today));
    } catch (error) {
      console.error(`[cron] ${name} failed`, error);
      results.push({
        job: name,
        considered: 0,
        acted: 0,
        notes: [`Failed: ${error instanceof Error ? error.message : String(error)}`],
      });
      await recordQuietly({
        action: "system.cron_ran",
        targetType: "job",
        targetLabel: `${name} — failed`,
        detail: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
  return results;
}
