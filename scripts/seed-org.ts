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

const DEPARTMENTS = [
  "Trading",
  "Research",
  "Operations & Settlement",
  "Accounts & Finance",
  "Information Technology",
  "Human Resources & Admin",
  "Compliance",
  "Branch Operations",
  "Marketing & Business Development",
];

const DESIGNATIONS = [
  "Managing Director",
  "Head of Department",
  "Divisional Manager",
  "Branch Manager",
  "Senior Relationship Manager",
  "Relationship Manager",
  "Senior Executive",
  "Executive",
  "Junior Executive",
  "Officer",
];

/** rank orders reports; 1 is most senior. */
const GRADES: [string, number][] = [
  ["Top Management", 1],
  ["Grade 1", 2],
  ["Grade 2", 3],
  ["Grade 3", 4],
  ["Grade 4", 5],
  ["Support Staff", 6],
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
