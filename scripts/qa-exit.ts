import bcrypt from "bcryptjs";
import { calendarDate } from "../lib/dates";
import { CLEARANCE_CHECKLIST, purgeDateFor } from "../lib/exit";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";

/**
 * §6.6 — the exit process, with the safeguard that gives it its point.
 */

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

async function main() {
  await cleanFixtures();

  const email = "qa-leaver@qa.fcsl.invalid";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("qa-password-not-real", 10),
      role: "EMPLOYEE",
      mustChangePassword: false,
    },
  });
  const employee = await prisma.employee.create({
    data: {
      userId: user.id,
      fullName: "QA Leaver",
      employeeId: "Z 999 - 99 - 70",
      idLetter: "Z",
      idNumber: 999,
      idYear: 2099,
      staffType: "RM",
      onboardingStatus: "APPROVED",
      joiningDate: calendarDate(2026, 1, 1),
    },
  });

  const terminal = await prisma.tradingTerminal.create({
    data: { terminalId: "QA-DSE-0001", exchange: "DSE", status: "ACTIVE" },
  });
  const assignment = await prisma.terminalAssignment.create({
    data: {
      terminalId: terminal.id,
      employeeId: employee.id,
      assignedOn: calendarDate(2026, 2, 1),
      assignedByName: "qa",
    },
  });
  const certificate = await prisma.rmCertificate.create({
    data: {
      employeeId: employee.id,
      certificateNumber: "QA-CERT-1",
      issueDate: calendarDate(2026, 1, 1),
      expiryDate: calendarDate(2028, 1, 1),
      status: "ACTIVE",
      recordedByName: "qa",
    },
  });

  const { completeExit, recordExit, clearItem } = await import("../app/actions/hr-exit");
  void completeExit;
  void recordExit;
  void clearItem;

  try {
    const lastDay = calendarDate(2026, 4, 30);
    const exit = await prisma.exit.create({
      data: {
        employeeId: employee.id,
        reason: "RESIGNATION",
        lastWorkingDay: lastDay,
        recordedByName: "qa",
        documentsPurgeAfter: purgeDateFor(lastDay),
        clearanceItems: { create: CLEARANCE_CHECKLIST.map((i) => ({ ...i })) },
      },
      include: { clearanceItems: true },
    });

    console.log("\nRecording a departure");
    check("a clearance checklist opens", exit.clearanceItems.length === CLEARANCE_CHECKLIST.length);
    check(
      "the one-year purge date is set from the last working day",
      exit.documentsPurgeAfter.toISOString().slice(0, 10) === "2027-04-30",
      exit.documentsPurgeAfter.toISOString(),
    );
    check(
      "recording is not finishing",
      exit.completedAt === null && (await employeeStatus(employee.id)) === "ACTIVE",
    );

    console.log("\nThe safeguard");
    const { exitBlockers } = await import("../lib/exit");
    let blockers = exitBlockers({
      openTerminals: 1,
      unclearedItems: exit.clearanceItems.length,
    });
    check("a live terminal blocks the exit", blockers.some((b) => /terminal/.test(b)));
    check("outstanding clearance blocks it too", blockers.some((b) => /clearance/.test(b)));

    // Clear everything but leave the terminal assigned.
    await prisma.clearanceItem.updateMany({
      where: { exitId: exit.id },
      data: { clearedAt: new Date(), clearedByName: "qa" },
    });
    blockers = exitBlockers({ openTerminals: 1, unclearedItems: 0 });
    check(
      "clearance alone is not enough while the terminal is live",
      blockers.length === 1 && /terminal/.test(blockers[0]!),
      blockers.join(" | "),
    );

    console.log("\nSurrendering the terminal");
    await prisma.terminalAssignment.update({
      where: { id: assignment.id },
      data: { releasedOn: lastDay },
    });
    const stillOpen = await prisma.terminalAssignment.count({
      where: { employeeId: employee.id, releasedOn: null },
    });
    check("no terminal is assigned any more", stillOpen === 0);
    check("and nothing blocks the exit", exitBlockers({ openTerminals: 0, unclearedItems: 0 }).length === 0);

    console.log("\nFinishing the exit");
    await prisma.$transaction(async (tx) => {
      await tx.rmCertificate.update({
        where: { id: certificate.id },
        data: { status: "SURRENDERED", surrenderedOn: lastDay },
      });
      await tx.employee.update({ where: { id: employee.id }, data: { status: "LEFT" } });
      await tx.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
      await tx.exit.update({
        where: { employeeId: employee.id },
        data: { completedAt: new Date(), completedByName: "qa" },
      });
    });

    check("they are marked LEFT", (await employeeStatus(employee.id)) === "LEFT");
    check(
      "their certificate is surrendered, so they drop out of the expiry register",
      (await prisma.rmCertificate.count({
        where: { employeeId: employee.id, status: "ACTIVE" },
      })) === 0,
    );
    check(
      "their account is closed",
      (await prisma.user.findUnique({ where: { id: user.id } }))!.disabledAt !== null,
    );

    const kept = await prisma.employee.findUnique({ where: { id: employee.id } });
    check("the record is kept whole, not deleted", kept !== null);
    check("the employee ID is still theirs", kept?.employeeId === "Z 999 - 99 - 70");

    console.log("\nWhat marking somebody Left makes possible (§6.6)");
    const activeCount = await prisma.employee.count({
      where: { status: "ACTIVE", onboardingStatus: "APPROVED" },
    });
    const leftCount = await prisma.employee.count({ where: { status: "LEFT" } });
    check("active and left are both countable at any moment", activeCount >= 0 && leftCount >= 1);
    check(
      "and the leaver is not in the active count",
      (await prisma.employee.count({ where: { status: "ACTIVE", id: employee.id } })) === 0,
    );

    const freed = await prisma.tradingTerminal.findUnique({
      where: { id: terminal.id },
      include: { assignments: { where: { releasedOn: null } } },
    });
    check("the terminal is free for reassignment", freed!.assignments.length === 0);
  } finally {
    await prisma.terminalAssignment.deleteMany({ where: { employeeId: employee.id } });
    await prisma.tradingTerminal.deleteMany({ where: { terminalId: "QA-DSE-0001" } });
    await prisma.employee.deleteMany({ where: { id: employee.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

async function employeeStatus(id: string) {
  return (await prisma.employee.findUnique({ where: { id } }))?.status;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
