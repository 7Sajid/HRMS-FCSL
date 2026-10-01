import { args, finish, prisma } from "./_cli";

/**
 * FCSL's own lists — divisions, branches, departments, designations and grades.
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

// FCSL's own designations, given by FCSL on 2 October 2026, singular because a
// designation is one person's job title. "General Manager" was missing from the
// list FCSL sent and they added it.
//
// Manager and Department Head are the same rank. Every department head is a
// manager; most managers are not department heads. Which manager heads which
// department is NOT this list — it is Department.headId, set by the HR Head on
// the settings screen, so a promotion changes one dropdown and no job title.
//
// No rank here: Designation has none, and these sort alphabetically wherever
// they are shown.
// Bangladesh's eight administrative divisions (FCSL, 2 October 2026). FCSL's
// divisions are geographic and hold branches: Dhaka is a division with several
// offices under it, Chattogram is another. The HR Head retires the ones FCSL has
// no office in.
const DIVISIONS = [
  "Dhaka",
  "Chattogram",
  "Khulna",
  "Rajshahi",
  "Barishal",
  "Sylhet",
  "Rangpur",
  "Mymensingh",
];

const DESIGNATIONS = [
  "Intern",
  "Junior Executive",
  "Executive",
  "Senior Executive",
  "Assistant Manager",
  "Manager",
  "Department Head",
  "Divisional Manager",
  "Deputy General Manager",
  "AGM",
  "General Manager",
  "Senior General Manager",
  "CEO",
  "COO",
  "Deputy CEO",
  "Deputy COO",
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
  const [divisions, branches, departments, designations, grades] = await Promise.all([
    prisma.division.findMany({ orderBy: { name: "asc" } }),
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

  show("Divisions", divisions);
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

  for (const name of DIVISIONS) {
    await prisma.division.upsert({ where: { name }, update: {}, create: { name } });
  }

  // One branch, so that a joiner can be approved before FCSL's real branch
  // list is entered. Head Office is the safe default; the rest come from HR.
  // Put in Dhaka, since that is where FCSL's head office is, so the Super
  // Admin's division filter has something behind it on day one.
  const dhaka = await prisma.division.findUnique({ where: { name: "Dhaka" } });
  await prisma.branch.upsert({
    where: { code: "HO" },
    update: {},
    create: {
      name: "Head Office",
      code: "HO",
      openedOn: new Date(Date.UTC(2000, 0, 1)),
      divisionId: dhaka?.id ?? null,
    },
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
