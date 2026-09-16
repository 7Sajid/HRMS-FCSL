import { allocateEmployeeId, employeeIdIsTaken, parseEmployeeId } from "../lib/employee-id";
import { args, box, die, finish, optional, prisma, required } from "./_cli";

/**
 * Open the locked door: issue the employee ID, set branch, department,
 * designation, grade and manager, and let the panel appear (§4 step 5).
 *
 * This is what P3.2's review screen does. Until that screen exists, this is
 * how a joiner is approved.
 *
 *   npm run hrm:approve -- --email karim@fcslbd.com --branch HO \
 *     --department Trading --designation "Associate" \
 *     --grade "Grade 2" --manager boss@fcslbd.com --joining 2026-09-06
 *
 * `--id "A 413 - 26 - 70"` overrides the proposed ID. The system refuses one
 * anybody has ever held, including after they left (§12.1).
 */

const USAGE =
  "npm run hrm:approve -- --email x@fcslbd.com [--branch CODE] [--department NAME] " +
  "[--designation NAME] [--grade NAME] [--manager boss@fcslbd.com] [--joining YYYY-MM-DD] [--id 'A 413 - 26 - 70']";

async function main() {
  const values = args();
  const email = required(values, "email", USAGE).toLowerCase();

  const user = await prisma.user.findUnique({ where: { email }, include: { employee: true } });
  if (!user?.employee) die(`No employee record for ${email}`);
  const employee = user.employee;

  if (employee.onboardingStatus === "APPROVED") {
    die(`${employee.fullName} is already through the door (${employee.employeeId ?? "no ID"}).`);
  }

  const joining = optional(values, "joining");
  const joiningDate = joining ? new Date(`${joining}T00:00:00Z`) : new Date();
  if (Number.isNaN(joiningDate.getTime())) die("--joining must be YYYY-MM-DD");
  const joiningYear = joiningDate.getUTCFullYear();

  // Look up the org rows by their human names, because that is what somebody
  // types at a terminal at nine in the evening.
  const branchCode = optional(values, "branch");
  const branch = branchCode
    ? await prisma.branch.findUnique({ where: { code: branchCode.toUpperCase() } })
    : null;
  if (branchCode && !branch) die(`No branch with code ${branchCode}. Run: npm run hrm:org`);

  const departmentName = optional(values, "department");
  const department = departmentName
    ? await prisma.department.findUnique({ where: { name: departmentName } })
    : null;
  if (departmentName && !department) die(`No department "${departmentName}". Run: npm run hrm:org`);

  const designationName = optional(values, "designation");
  const designation = designationName
    ? await prisma.designation.findUnique({ where: { name: designationName } })
    : null;
  if (designationName && !designation) die(`No designation "${designationName}".`);

  const gradeName = optional(values, "grade");
  const grade = gradeName ? await prisma.grade.findUnique({ where: { name: gradeName } }) : null;
  if (gradeName && !grade) die(`No grade "${gradeName}".`);

  const managerEmail = optional(values, "manager");
  const manager = managerEmail
    ? await prisma.user.findUnique({
        where: { email: managerEmail.toLowerCase() },
        include: { employee: true },
      })
    : null;
  if (managerEmail && !manager?.employee) die(`No employee record for manager ${managerEmail}`);

  const override = optional(values, "id");
  if (override) {
    const parts = parseEmployeeId(override);
    if (!parts) die(`"${override}" is not a valid employee ID. The format is A 413 - 26 - 70.`);
    // §12.1: refuse an ID anybody has ever held, including after they left.
    if (await employeeIdIsTaken(override)) die(`${override} has already been issued. IDs are never reused.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    let employeeId = override;
    let parts = override ? parseEmployeeId(override)! : null;

    if (!employeeId) {
      const allocated = await allocateEmployeeId(tx, joiningYear);
      employeeId = allocated.employeeId;
      parts = allocated.parts;
    }

    const updated = await tx.employee.update({
      where: { id: employee.id },
      data: {
        employeeId,
        idLetter: parts!.letter,
        idNumber: parts!.number,
        idYear: parts!.year,
        onboardingStatus: "APPROVED",
        approvedAt: new Date(),
        approvedByName: "Command line",
        joiningDate,
        branchId: branch?.id ?? null,
        departmentId: department?.id ?? null,
        designationId: designation?.id ?? null,
        gradeId: grade?.id ?? null,
        managerId: manager?.employee?.id ?? null,
      },
    });

    // The dated history. A transfer later writes another row; this one is
    // never overwritten (§6.1).
    await tx.employeeAssignment.create({
      data: {
        employeeId: employee.id,
        effectiveFrom: joiningDate,
        branchId: branch?.id ?? null,
        departmentId: department?.id ?? null,
        designationId: designation?.id ?? null,
        gradeId: grade?.id ?? null,
        managerId: manager?.employee?.id ?? null,
        reason: "JOINING",
        recordedByName: "Command line",
      },
    });

    for (const [action, detail] of [
      ["employee.id_issued", { employeeId, proposed: !override }],
      ["documents.approved", { via: "scripts/approve-joiner.ts" }],
    ] as const) {
      await tx.auditEvent.create({
        data: {
          action,
          actorName: "Command line",
          actorRole: "HR_EXECUTIVE",
          targetType: "employee",
          targetId: employee.id,
          targetLabel: employee.fullName,
          detail,
        },
      });
    }

    return updated;
  });

  box([
    `${result.fullName}  ·  ${result.staffType}`,
    `Employee ID:  ${result.employeeId}`,
    `Branch:       ${branch?.name ?? "—"}`,
    `Department:   ${department?.name ?? "—"}`,
    `Designation:  ${designation?.name ?? "—"}`,
    `Grade:        ${grade?.name ?? "—"}`,
    `Reports to:   ${manager?.employee?.fullName ?? "—"}`,
    `Joined:       ${joiningDate.toISOString().slice(0, 10)}`,
  ]);
  console.log("Their panel opens the moment they next refresh.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
