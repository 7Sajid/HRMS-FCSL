-- FCSL's real departments (given by FCSL, 1 October 2026).
--
--   Accounts · IT · HR and Compliance · CDS · Operations · Digital Brokerage
--
-- Replacing the nine placeholders in scripts/seed-org.ts, which that file has
-- always described as "a starting point for FCSL to correct, not a description
-- of the company". This is the correction.
--
-- Done here rather than left to the settings screen because the screen can add
-- and retire but not rename, and three of the placeholders are plainly the same
-- department under a longer name. Renaming keeps the people already posted to
-- them attached; adding a new row and retiring the old one would quietly empty
-- those postings.
--
-- Every statement is guarded on the exact placeholder name. A list FCSL has
-- already corrected by hand does not match, so nothing of theirs is touched,
-- and running this twice changes nothing the second time.

-- 1. The three that are the same department, spelled FCSL's way.
UPDATE "Department" SET "name" = 'Accounts'   WHERE "name" = 'Accounts & Finance';
UPDATE "Department" SET "name" = 'IT'         WHERE "name" = 'Information Technology';
UPDATE "Department" SET "name" = 'Operations' WHERE "name" = 'Operations & Settlement';

-- 2. FCSL keeps HR and Compliance as one department. The placeholder list split
--    them, so the larger one is renamed and the other retired below — renamed
--    rather than created so that anybody already posted to HR stays posted.
UPDATE "Department" SET "name" = 'HR and Compliance' WHERE "name" = 'Human Resources & Admin';

-- 3. The two FCSL has that the placeholder list never imagined.
INSERT INTO "Department" ("id", "name")
VALUES (gen_random_uuid()::text, 'CDS')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "Department" ("id", "name")
VALUES (gen_random_uuid()::text, 'Digital Brokerage')
ON CONFLICT ("name") DO NOTHING;

-- 4. The placeholders FCSL does not have. Retired, never deleted:
--    EmployeeAssignment.departmentId is ON DELETE SET NULL, so removing a row
--    here would blank the department out of somebody's posting history and
--    leave a record that cannot say where they worked. A retired department
--    disappears from every dropdown — the requisition approval screen and the
--    department-head list both ask for retiredAt IS NULL — and stays legible
--    behind the rows that still point at it.
UPDATE "Department"
   SET "retiredAt" = NOW()
 WHERE "retiredAt" IS NULL
   AND "name" IN (
     'Compliance',
     'Trading',
     'Research',
     'Branch Operations',
     'Marketing & Business Development'
   );
