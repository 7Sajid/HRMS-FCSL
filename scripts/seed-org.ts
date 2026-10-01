import { args, finish, prisma } from "./_cli";

/**
 * FCSL's own lists — branches, departments, designations and grades.
 *
 * Kept out of prisma/seed.ts on purpose: that file creates what the system
 * cannot start without, and an organisation chart is not that. These values
 * are a starting point for FCSL to correct, not a description of the company.
 * HR edits them on the settings screens in P3 and P4.
 *
 *   npm run hrm:org            list what exists
 *   npm run hrm:org -- --seed  add the defaults, skipping anything present
 */

// FCSL's own six, given by FCSL on 1 October 2026. These are no longer a
// guess: the nine placeholders that stood here before were renamed and retired
// by 20261001140000_fcsl_departments, which is what brings an existing database
// to this list.
const DEPARTMENTS = [
  "Accounts",
  "IT",
  "HR and Compliance",
  "CDS",
  "Operations",
  "Digital Brokerage",
];

const DESIGNATIONS = [
  "Managing Director",
  "Head of Department",
  "Divisional Manager",
  "Branch Manager",
  "Senior Associate",
  "Associate",
  "Senior Executive",
  "Executive",
  "Junior Executive",
  "Officer",
];

/** rank orders reports; 1 is most senior. */
// FCSL's own grades, given by FCSL on 2 October 2026. Three AR levels and four
// AD levels, each with an a, b and c. These are real, not a guess — FCSL stated
// there are no others.
//
// The numbers are SENIORITY, and they are PROVISIONAL: they follow the order
// FCSL listed the grades in, because the only thing rank does is stop
// "headcount by grade" sorting alphabetically. FCSL has not yet said which end
// is the top. Correcting it is one UPDATE per grade, nothing else reads it.
const GRADES: [string, number][] = [
  ["AR1a", 1],
  ["AR1b", 2],
  ["AR1c", 3],
  ["AR2a", 4],
  ["AR2b", 5],
  ["AR2c", 6],
  ["AR3a", 7],
  ["AR3b", 8],
  ["AR3c", 9],
  ["AD1a", 10],
  ["AD1b", 11],
  ["AD1c", 12],
  ["AD2a", 13],
  ["AD2b", 14],
  ["AD2c", 15],
  ["AD3a", 16],
  ["AD3b", 17],
  ["AD3c", 18],
  ["AD4a", 19],
  ["AD4b", 20],
  ["AD4c", 21],
];

async function list() {
  const [branches, departments, designations, grades] = await Promise.all([
    prisma.branch.findMany({ orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.designation.findMany({ orderBy: { name: "asc" } }),
    prisma.grade.findMany({ orderBy: { rank: "asc" } }),
  ]);

  const show = (title: string, rows: { name: string; retiredAt?: Date | null }[]) => {
    console.log(`\n${title} (${rows.length})`);
    if (!rows.length) console.log("  — none —");
    for (const row of rows) console.log(`  ${row.retiredAt ? "· retired ·" : "·"} ${row.name}`);
  };

  show("Branches", branches);
  show("Departments", departments);
  show("Designations", designations);
  show("Grades", grades);
  console.log("");
}

async function seed() {
  let added = 0;

  for (const name of DEPARTMENTS) {
    const created = await prisma.department.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    if (created.createdAt.getTime() > Date.now() - 5000) added += 1;
  }
  for (const name of DESIGNATIONS) {
    await prisma.designation.upsert({ where: { name }, update: {}, create: { name } });
  }
  for (const [name, rank] of GRADES) {
    await prisma.grade.upsert({ where: { name }, update: {}, create: { name, rank } });
  }

  // One branch, so that a joiner can be approved before FCSL's real branch
  // list is entered. Head Office is the safe default; the rest come from HR.
  await prisma.branch.upsert({
    where: { code: "HO" },
    update: {},
    create: { name: "Head Office", code: "HO", openedOn: new Date(Date.UTC(2000, 0, 1)) },
  });

  console.log(`\n✓ org lists present (${added} newly added this run)`);
  console.log("  These are defaults for FCSL to correct, not a description of the company.\n");
  await list();
}

const values = args();
(values.seed ? seed() : list())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(finish);
