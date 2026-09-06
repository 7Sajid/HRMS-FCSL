import { prisma, finish } from "./_cli";
import { deleteObject } from "../lib/storage";

/**
 * Remove every QA fixture.
 *
 * The harnesses each delete their own fixtures by exact id in a `finally` —
 * but a `finally` only runs if the process reaches it, and a harness piped to
 * `head` dies on SIGPIPE partway through. That leaves a "QA HR Head" sitting
 * in the database with a real role, collecting real notifications. It happened.
 *
 * So cleanup is also available on its own, and every harness run starts with
 * it. This is the ONE place a blanket predicate is safe, because the predicate
 * is the reserved TLD `.invalid` — RFC 2606 guarantees it can never resolve,
 * so no real employee can ever have an address that matches.
 */

const FIXTURE_PATTERN = "%@qa.fcsl.invalid";

export async function cleanFixtures(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: "@qa.fcsl.invalid" } },
    include: { employee: { include: { documents: { select: { storageKey: true } } } } },
  });
  if (!users.length) return 0;

  // Files first: deleting the employee cascades the document rows and would
  // otherwise leave the objects behind with nothing pointing at them.
  for (const user of users) {
    for (const document of user.employee?.documents ?? []) {
      await deleteObject(document.storageKey);
    }
  }

  await prisma.user.deleteMany({ where: { email: { endsWith: "@qa.fcsl.invalid" } } });
  return users.length;
}

// Only run when invoked directly, not when imported by a harness.
if (process.argv[1]?.endsWith("qa-clean.ts")) {
  cleanFixtures()
    .then((count) => {
      console.log(count ? `Removed ${count} QA fixture account(s).` : "No QA fixtures to remove.");
      void FIXTURE_PATTERN;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(finish);
}
