-- FCSL's real employee grades (given by FCSL, 2 October 2026).
--
--   AR1a AR1b AR1c  AR2a AR2b AR2c  AR3a AR3b AR3c
--   AD1a AD1b AD1c  AD2a AD2b AD2c  AD3a AD3b AD3c  AD4a AD4b AD4c
--
-- Twenty-one: three AR levels and four AD levels, each with an a, b and c.
-- FCSL stated there are no others. The list they sent repeated AD1a three times
-- and had no AD1b or AD1c, which they confirmed was a typo for AD1a/AD1b/AD1c —
-- worth recording here because the name is unique, so the list as sent could not
-- have been entered at all.
--
-- These replace the six placeholders in scripts/seed-org.ts, which were never
-- FCSL's: Top Management, Grade 1 to Grade 4, and Support Staff.
--
-- WHY THIS BELONGS IN THE DATABASE: the 412-row import matches the Grade column
-- of the spreadsheet against these rows by name. A grade that is not here does
-- not fail the import — the person is created with no grade at all — so this
-- list existing, spelled exactly as the spreadsheet spells it, is what makes
-- that import land correctly.
--
-- `rank` is SENIORITY and is PROVISIONAL. It follows the order FCSL listed them
-- in; FCSL has not yet said which end is the top. Nothing reads it except the
-- sort order of "headcount by grade", so correcting it later is one UPDATE per
-- grade and no employee data moves.

INSERT INTO "Grade" ("id", "name", "rank") VALUES
  (gen_random_uuid()::text, 'AR1a', 1),
  (gen_random_uuid()::text, 'AR1b', 2),
  (gen_random_uuid()::text, 'AR1c', 3),
  (gen_random_uuid()::text, 'AR2a', 4),
  (gen_random_uuid()::text, 'AR2b', 5),
  (gen_random_uuid()::text, 'AR2c', 6),
  (gen_random_uuid()::text, 'AR3a', 7),
  (gen_random_uuid()::text, 'AR3b', 8),
  (gen_random_uuid()::text, 'AR3c', 9),
  (gen_random_uuid()::text, 'AD1a', 10),
  (gen_random_uuid()::text, 'AD1b', 11),
  (gen_random_uuid()::text, 'AD1c', 12),
  (gen_random_uuid()::text, 'AD2a', 13),
  (gen_random_uuid()::text, 'AD2b', 14),
  (gen_random_uuid()::text, 'AD2c', 15),
  (gen_random_uuid()::text, 'AD3a', 16),
  (gen_random_uuid()::text, 'AD3b', 17),
  (gen_random_uuid()::text, 'AD3c', 18),
  (gen_random_uuid()::text, 'AD4a', 19),
  (gen_random_uuid()::text, 'AD4b', 20),
  (gen_random_uuid()::text, 'AD4c', 21)
ON CONFLICT ("name") DO NOTHING;

-- The placeholders, retired and not deleted. Employee.gradeId and
-- EmployeeAssignment.gradeId are both ON DELETE SET NULL, so removing these rows
-- would blank the grade out of the postings that still point at them and leave a
-- record that cannot say what grade somebody held. A retired grade is struck
-- through in the settings list and offered nowhere else.
--
-- "Support Executive" is listed beside "Support Staff" because the September
-- rename reached the seed file but never the databases, so either name may be
-- the one actually present.
UPDATE "Grade"
   SET "retiredAt" = NOW()
 WHERE "retiredAt" IS NULL
   AND "name" IN (
     'Top Management',
     'Grade 1',
     'Grade 2',
     'Grade 3',
     'Grade 4',
     'Support Staff',
     'Support Executive'
   );
