import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import "dotenv/config";

const prisma = new PrismaClient();

/**
 * Seed. Idempotent — safe to run against a database that already has data,
 * because it never clobbers a value somebody has since changed.
 *
 * This creates only what the system cannot start without. FCSL's own
 * departments, designations, grades and branches come from scripts/seed-org.ts
 * so that this file does not invent an organisation chart.
 */

/**
 * Bangladesh Labour Act 2006 minimums (§6.2).
 *
 * These are a floor, not FCSL's policy. The HR Head raises or renames them on
 * the settings screen without a developer, and each change is saved with the
 * date it takes effect, so last year's leave still computes on last year's
 * rule.
 */
const LEAVE_TYPES = [
  {
    code: "CASUAL",
    name: "Casual leave",
    sortOrder: 1,
    days: 10,
    carryForward: false,
    note: "Labour Act 2006 s.115 — 10 days.",
  },
  {
    code: "SICK",
    name: "Sick leave",
    sortOrder: 2,
    days: 14,
    carryForward: false,
    // A medical certificate for anything longer than three days.
    attachmentAfter: 3,
    note: "Labour Act 2006 s.116 — 14 days.",
  },
  {
    code: "EARNED",
    name: "Earned leave",
    sortOrder: 3,
    days: 20,
    carryForward: true,
    carryForwardCap: 40,
    note: "Labour Act 2006 s.117 — one day for every 18 worked, so about 20 a year.",
  },
  {
    code: "MATERNITY",
    name: "Maternity leave",
    sortOrder: 4,
    days: 112,
    carryForward: false,
    // Labour Act 2006 s.46 gives this to women. Without it the type was
    // offered to every employee in the company.
    appliesTo: "FEMALE" as const,
    note: "Labour Act 2006 s.46 — 16 weeks.",
  },
  {
    code: "UNPAID",
    name: "Leave without pay",
    sortOrder: 5,
    days: 0,
    carryForward: false,
    // Zero entitlement by definition, so it must be allowed to exceed it.
    warnOnly: true,
    note: "No entitlement. Recorded so an absence has a reason attached to it.",
  },
] as const;

const SETTINGS = [
  {
    key: "requisition.escalationThreshold",
    value: "50000",
    note: "Taka. Above this a requisition goes to the Super Admin (§7.2).",
  },
  {
    key: "attendance.deadlineDayOfMonth",
    value: "5",
    note: "Branch sheets are due by this day of the following month (§6.3).",
  },
  {
    key: "certificate.warnMonthsBefore",
    value: "4",
    note: "Four months, and it warns only — it never blocks (§12.2).",
  },
  {
    key: "onboarding.reviewReminderWorkingDays",
    value: "2",
    note: "HR is reminded when a joiner has waited this long (§8).",
  },
  {
    key: "approval.escalateAfterWorkingDays",
    value: "3",
    note: "A request waiting this long turns amber and emails the approver (§7.3).",
  },
  {
    key: "documents.retentionYearsAfterExit",
    value: "1",
    note: "Files are purged after this. The employee record is kept for ever (§12.2).",
  },
] as const;

async function main() {
  // --- The employee ID counter (§12.1) -------------------------------------
  // "Your highest existing ID is A 412 - 26 - 70", so the next is 413. The
  // import of the 412 existing staff sets this again when it finishes.
  await prisma.employeeIdSequence.upsert({
    where: { id: 1 },
    // Never clobber a counter that has already issued IDs.
    update: {},
    create: { id: 1, letter: "A", nextNumber: 413 },
  });
  console.log("✓ employee ID sequence");

  // --- The working week (§12.2) --------------------------------------------
  // Friday and Saturday. Stored as a dated rule rather than a constant so that
  // if FCSL ever changes its week, last year's leave still computes correctly.
  const existingWeek = await prisma.weeklyOffRule.findFirst();
  if (!existingWeek) {
    await prisma.weeklyOffRule.create({
      data: {
        effectiveFrom: new Date(Date.UTC(2000, 0, 1)),
        days: [5, 6],
        createdByName: "Installation",
      },
    });
  }
  console.log("✓ weekly off — Friday and Saturday");

  // --- Leave types and their first rule ------------------------------------
  for (const type of LEAVE_TYPES) {
    const leaveType = await prisma.leaveType.upsert({
      where: { code: type.code },
      // Never clobbered on a re-run: who a leave type is for is the HR Head's
      // setting once the system is live. Existing installations are corrected
      // once, by the data migration beside the column that added it.
      update: {},
      create: {
        code: type.code,
        name: type.name,
        sortOrder: type.sortOrder,
        appliesTo: "appliesTo" in type ? type.appliesTo : "ALL",
      },
    });

    const effectiveFrom = new Date(Date.UTC(2000, 0, 1));
    const hasRule = await prisma.leaveTypeRule.findUnique({
      where: { leaveTypeId_effectiveFrom: { leaveTypeId: leaveType.id, effectiveFrom } },
    });
    if (!hasRule) {
      await prisma.leaveTypeRule.create({
        data: {
          leaveTypeId: leaveType.id,
          effectiveFrom,
          daysPerYear: type.days,
          carryForward: type.carryForward,
          carryForwardCap: "carryForwardCap" in type ? type.carryForwardCap : null,
          overBalance: "warnOnly" in type && type.warnOnly ? "WARN" : "REFUSE",
          attachmentRequiredAfterDays: "attachmentAfter" in type ? type.attachmentAfter : null,
          createdByName: "Installation",
        },
      });
    }
  }
  console.log(`✓ ${LEAVE_TYPES.length} leave types, seeded with Labour Act 2006 minimums`);

  // --- Settings ------------------------------------------------------------
  for (const setting of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      // update:{} on purpose — a value FCSL has since changed is never reset
      // by re-running the seed.
      update: {},
      create: { key: setting.key, value: setting.value, updatedByName: "Installation" },
    });
  }
  console.log(`✓ ${SETTINGS.length} settings`);

  // --- The first Super Admin (§3) ------------------------------------------
  //
  // "The draft says the Super Admin approves the HR Head, but it never says who
  // creates or approves the Super Admin. On the day the system goes live there
  // is nobody inside it to do anything."
  //
  // So this one account is created by hand at installation, skipping the
  // locked door because there is nothing above it — and the fact that it was
  // created outside the normal process is itself written permanently into the
  // record, which is what §3 requires.
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Super Admin";

  if (!email || !password) {
    console.log("• no ADMIN_EMAIL / ADMIN_PASSWORD set — skipping the first Super Admin");
  } else if (password.length < 12) {
    console.log("✗ ADMIN_PASSWORD must be at least 12 characters — skipping");
  } else if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`• ${email} already exists — left untouched`);
  } else {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash: await bcrypt.hash(password, 10),
          role: "SUPER_ADMIN",
          // The installer chose this password themselves, so there is nothing
          // to hand over and nothing to force a change of.
          mustChangePassword: false,
          createdByName: "Installation",
        },
      });

      // The Super Admin is a named director, and a director is a person with a
      // staff file. Created directly at Stage 2 — there is nobody above them to
      // open the locked door, and nothing for that door to protect.
      const employee = await tx.employee.create({
        data: {
          userId: user.id,
          fullName: name,
          onboardingStatus: "APPROVED",
          approvedAt: new Date(),
          approvedByName: "Installation",
        },
      });

      await tx.auditEvent.create({
        data: {
          action: "system.bootstrap_super_admin",
          actorName: "Installation",
          actorRole: "SUPER_ADMIN",
          targetType: "user",
          targetId: user.id,
          targetLabel: `${name} <${email}>`,
          detail: {
            note:
              "Created by hand at installation, outside the normal approval chain, " +
              "because on the day the system goes live there is nobody inside it to " +
              "approve anything. This line exists because §3 requires that the fact " +
              "be written permanently into the record.",
            employeeId: employee.id,
          },
        },
      });
    });
    console.log(`✓ first Super Admin: ${name} <${email}>`);
  }
}

main()
  .then(() => console.log("\nSeed complete."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
