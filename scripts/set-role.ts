import type { Role } from "@prisma/client";
import { args, die, finish, prisma, required } from "./_cli";

/**
 * Change somebody's role. For fixing a mis-set role without a screen.
 *
 *   npm run hrm:role -- --email karim@fcslbd.com --role MANAGER
 */

const ROLES: Role[] = ["EMPLOYEE", "MANAGER", "HR_EXECUTIVE", "HR_HEAD", "SUPER_ADMIN"];

async function main() {
  const values = args();
  const email = required(values, "email", "npm run hrm:role -- --email x@y --role MANAGER").toLowerCase();
  const role = required(values, "role", `--role must be one of ${ROLES.join(", ")}`).toUpperCase() as Role;
  if (!ROLES.includes(role)) die(`--role must be one of ${ROLES.join(", ")}`);

  const user = await prisma.user.findUnique({ where: { email }, include: { employee: true } });
  if (!user) die(`No account for ${email}`);
  if (user.role === role) {
    console.log(`\n${email} is already ${role}. Nothing changed.\n`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { role } });
    await tx.auditEvent.create({
      data: {
        action: "account.role_changed",
        actorName: "Command line",
        actorRole: "SUPER_ADMIN",
        targetType: "user",
        targetId: user.id,
        targetLabel: `${user.employee?.fullName ?? email}`,
        detail: { changes: { role: { from: user.role, to: role } }, via: "scripts/set-role.ts" },
      },
    });
  });

  console.log(`\n✓ ${user.employee?.fullName ?? email}: ${user.role} → ${role}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
