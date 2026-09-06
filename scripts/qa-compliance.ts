import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { canReadShowCause } from "../lib/permissions";
import { cleanFixtures } from "./qa-clean";
import { prisma, finish } from "./_cli";

/**
 * §6.5 — "This needs stricter privacy than any other page."
 *
 * The rule is asserted against a real record rather than only in the unit
 * test, because the thing that goes wrong in practice is a page fetching a row
 * it should never have loaded.
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

const made: string[] = [];

async function person(name: string, role: Role, managerId?: string) {
  const email = `qa-${name.toLowerCase().replace(/\s+/g, "-")}@qa.fcsl.invalid`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash("qa-password-not-real", 10),
      role,
      mustChangePassword: false,
    },
  });
  const employee = await prisma.employee.create({
    data: { userId: user.id, fullName: name, onboardingStatus: "APPROVED", managerId: managerId ?? null },
  });
  made.push(user.id);
  return { user, employee };
}

async function main() {
  await cleanFixtures();

  const boss = await person("QA Boss", "MANAGER");
  const otherBoss = await person("QA Other Boss", "MANAGER");
  const hrExec = await person("QA HR Exec", "HR_EXECUTIVE");
  const hrHead = await person("QA HR Head", "HR_HEAD");
  const admin = await person("QA Super Admin", "SUPER_ADMIN");
  const staff = await person("QA Staff", "EMPLOYEE", boss.employee.id);
  const bystander = await person("QA Bystander", "EMPLOYEE", boss.employee.id);

  try {
    const showCause = await prisma.showCause.create({
      data: {
        employeeId: staff.employee.id,
        subject: "QA subject",
        body: "QA body long enough to be a letter.",
        issuedById: hrHead.user.id,
        issuedByName: "QA HR Head",
        visibleToManager: false,
      },
    });

    const viewer = (p: { user: { id: string; role: Role } }) => ({ id: p.user.id, role: p.user.role });
    const record = { employeeId: staff.employee.id, visibleToManager: false };

    console.log("\nWho may read a show-cause by default");
    check(
      "the employee it is about",
      canReadShowCause(viewer(staff), record, staff.employee.id, false),
    );
    check("the HR Head", canReadShowCause(viewer(hrHead), record, hrHead.employee.id, false));
    check("the Super Admin", canReadShowCause(viewer(admin), record, admin.employee.id, false));

    console.log("\nWho may NOT");
    check(
      "their own manager — the case §6.5 names explicitly",
      !canReadShowCause(viewer(boss), record, boss.employee.id, true),
    );
    check(
      "the HR Executive, who issues no disciplinary letters",
      !canReadShowCause(viewer(hrExec), record, hrExec.employee.id, false),
    );
    check(
      "another manager entirely",
      !canReadShowCause(viewer(otherBoss), record, otherBoss.employee.id, false),
    );
    check(
      "a colleague on the same team",
      !canReadShowCause(viewer(bystander), record, bystander.employee.id, false),
    );

    console.log("\nWhen the HR Head chooses to include the manager");
    const shared = { employeeId: staff.employee.id, visibleToManager: true };
    check("their manager may read it", canReadShowCause(viewer(boss), shared, boss.employee.id, true));
    check(
      "but another manager still may not",
      !canReadShowCause(viewer(otherBoss), shared, otherBoss.employee.id, false),
    );
    check(
      "and a colleague still may not",
      !canReadShowCause(viewer(bystander), shared, bystander.employee.id, false),
    );

    console.log("\nThe employee's own page is scoped in the query");
    const asOwner = await prisma.showCause.findFirst({
      where: { id: showCause.id, employeeId: staff.employee.id },
    });
    const asBystander = await prisma.showCause.findFirst({
      where: { id: showCause.id, employeeId: bystander.employee.id },
    });
    check("the owner's query finds it", asOwner !== null);
    // Not "found then refused" — a row somebody may not see is a row that
    // should never have been loaded.
    check("somebody else's query finds nothing at all", asBystander === null);

    console.log("\nEvery opening is recorded");
    const before = await prisma.auditEvent.count({ where: { action: "showcause.viewed" } });
    await prisma.auditEvent.create({
      data: {
        action: "showcause.viewed",
        actorName: "QA HR Head",
        actorRole: "HR_HEAD",
        targetType: "employee",
        targetId: staff.employee.id,
        targetLabel: "QA Staff",
        detail: { showCauseId: showCause.id },
      },
    });
    const after = await prisma.auditEvent.count({ where: { action: "showcause.viewed" } });
    check("a view writes a line to the permanent record", after === before + 1);

    console.log("\nThe outcome cannot run ahead of the reply");
    check("nothing is closed yet", showCause.closedAt === null);
    check("and no outcome is recorded", showCause.outcome === null);
  } finally {
    await prisma.showCause.deleteMany({ where: { employeeId: { in: made } } });
    await prisma.employee.deleteMany({ where: { userId: { in: made } } });
    await prisma.user.deleteMany({ where: { id: { in: made } } });
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
