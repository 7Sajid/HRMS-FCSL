import bcrypt from "bcryptjs";
import type { Role, StaffType } from "@prisma/client";
import { actorFrom } from "../lib/audit";
import { generatePassword, forDictation } from "../lib/passwords";
import { args, box, die, finish, optional, prisma, required } from "./_cli";

/**
 * Create an account, exactly as §4 step 1 describes: three pieces of
 * information only — name, email address and mobile number — plus what kind of
 * user this will be, because that decides which documents will be demanded.
 *
 * This is what the HR Executive's screen does in P3.1. Until that screen
 * exists, this is how an account is made; afterwards it stays, because it is
 * how you recover when the screen is broken at nine in the evening.
 *
 *   npm run hrm:account -- --name "Karim Hossain" --email karim@fcslbd.com \
 *     --mobile 01712345678 --role EMPLOYEE --type RM
 */

const USAGE =
  'npm run hrm:account -- --name "Full Name" --email x@fcslbd.com --mobile 017… [--role EMPLOYEE|MANAGER|HR_EXECUTIVE|HR_HEAD|SUPER_ADMIN] [--type STAFF|RM]';

const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"];

async function main() {
  const values = args();
  const fullName = required(values, "name", USAGE);
  const email = required(values, "email", USAGE).toLowerCase();
  const mobile = required(values, "mobile", USAGE);
  const role = (optional(values, "role") ?? "EMPLOYEE").toUpperCase() as Role;
  const staffType = (optional(values, "type") ?? "STAFF").toUpperCase() as StaffType;

  if (!ROLES.includes(role)) die(`--role must be one of ${ROLES.join(", ")}`);
  if (staffType !== "STAFF" && staffType !== "RM") die("--type must be STAFF or RM");
  if (await prisma.user.findUnique({ where: { email } })) die(`${email} already has an account.`);

  // The password works once and expires in seven days. §4: "An unused
  // temporary password that stays valid for months is a way into the system
  // that nobody is watching."
  const password = generatePassword(16);
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);

  const { employee } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        role,
        mustChangePassword: true,
        tempPasswordExpiresAt: expiresAt,
        createdByName: "Command line",
      },
    });

    // Stage 1. The account exists, the person can log in, and the only thing
    // they can do is upload their documents.
    const employee = await tx.employee.create({
      data: { userId: user.id, fullName, mobile, staffType, onboardingStatus: "DRAFT" },
    });

    const actor = actorFrom({ id: user.id, fullName: "Command line", role });
    await tx.auditEvent.create({
      data: {
        action: "account.created",
        actorName: "Command line",
        actorRole: role,
        targetType: "user",
        targetId: user.id,
        targetLabel: `${fullName} <${email}>`,
        detail: { role, staffType, via: "scripts/create-account.ts" },
      },
    });
    await tx.auditEvent.create({
      data: {
        action: "auth.temp_password_issued",
        actorName: "Command line",
        actorRole: role,
        targetType: "user",
        targetId: user.id,
        targetLabel: email,
        detail: { expiresAt: expiresAt.toISOString() },
      },
    });
    void actor;
    return { employee };
  });

  box([
    `${fullName}  ·  ${role}  ·  ${staffType}`,
    `${email}`,
    "",
    `Temporary password:  ${forDictation(password)}`,
    "",
    "Hand this over by phone or in person — never by email.",
    `It works once and expires ${expiresAt.toDateString()}.`,
  ]);
  console.log(`Employee record: ${employee.id}`);
  console.log("They are at Stage 1. Their panel opens when their documents are approved.\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
