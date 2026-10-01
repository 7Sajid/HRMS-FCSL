-- FCSL's real designations (given by FCSL, 2 October 2026).
--
--   Intern · Junior Executive · Executive · Senior Executive · Assistant Manager
--   Manager · Department Head · Divisional Manager · Deputy General Manager
--   AGM · General Manager · Senior General Manager
--   CEO · COO · Deputy CEO · Deputy COO
--
-- Sixteen. FCSL sent fifteen with four of them plural — Junior Executives,
-- Executives, Senior Executives, Managers — and confirmed they should be
-- singular, because a designation is one person's job title and a record saying
-- "Designation: Managers" reads as a group. They also confirmed that "General
-- Manager" had been missed between AGM and Senior General Manager, and that AGM
-- stays abbreviated.
--
-- Manager and Department Head are the SAME RANK. Every department head is a
-- manager; most managers are not department heads. Which manager heads which
-- department is deliberately not this list — it is Department.headId, set by the
-- HR Head on the settings screen (20261001090000). So somebody taking over a
-- department changes one dropdown, and somebody promoted out of it changes one
-- dropdown back, with no job title rewritten either time.
--
-- Designation carries no rank: these sort alphabetically wherever they appear,
-- so the order above is for reading, not for seniority.

-- "Head of Department" is the same title FCSL spells "Department Head", so it is
-- renamed rather than replaced — the person already holding it stays held. Done
-- before the inserts, so the insert below finds the name already taken.
UPDATE "Designation" SET "name" = 'Department Head' WHERE "name" = 'Head of Department';

INSERT INTO "Designation" ("id", "name") VALUES
  (gen_random_uuid()::text, 'Intern'),
  (gen_random_uuid()::text, 'Junior Executive'),
  (gen_random_uuid()::text, 'Executive'),
  (gen_random_uuid()::text, 'Senior Executive'),
  (gen_random_uuid()::text, 'Assistant Manager'),
  (gen_random_uuid()::text, 'Manager'),
  (gen_random_uuid()::text, 'Department Head'),
  (gen_random_uuid()::text, 'Divisional Manager'),
  (gen_random_uuid()::text, 'Deputy General Manager'),
  (gen_random_uuid()::text, 'AGM'),
  (gen_random_uuid()::text, 'General Manager'),
  (gen_random_uuid()::text, 'Senior General Manager'),
  (gen_random_uuid()::text, 'CEO'),
  (gen_random_uuid()::text, 'COO'),
  (gen_random_uuid()::text, 'Deputy CEO'),
  (gen_random_uuid()::text, 'Deputy COO')
ON CONFLICT ("name") DO NOTHING;

-- The placeholders FCSL does not use, retired and not deleted:
-- Employee.designationId and EmployeeAssignment.designationId are both
-- ON DELETE SET NULL, so removing these rows would blank the job title out of
-- postings that still point at them.
--
-- "Branch Manager" goes with them. FCSL has branch managers, but the title is
-- not on their list: a branch manager is a Manager who is named on a branch
-- record (Branch.branchManagerId), the same shape as a department head.
--
-- Both spellings of the Associate titles appear here because the September
-- rename reached scripts/seed-org.ts and never the databases, so either the old
-- or the new wording may be the one present.
UPDATE "Designation"
   SET "retiredAt" = NOW()
 WHERE "retiredAt" IS NULL
   AND "name" IN (
     'Managing Director',
     'Branch Manager',
     'Officer',
     'Relationship Manager',
     'Senior Relationship Manager',
     'Associate',
     'Senior Associate'
   );
