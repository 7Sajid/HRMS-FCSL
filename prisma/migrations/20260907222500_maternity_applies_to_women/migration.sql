-- The column shipped with a default of ALL, which is right for a new column
-- and wrong for the row that forced it to exist: maternity leave was being
-- offered to every employee in the company.
--
-- Corrected once, here, rather than in the seed. The seed never clobbers this
-- column on a re-run because who a leave type is for becomes the HR Head's
-- setting the moment the system is live, and a re-seed must not undo their
-- decision. This migration runs against installations that already exist.
--
-- Guarded on the current value so it cannot overwrite a deliberate choice
-- that has already been made.
UPDATE "LeaveType"
SET "appliesTo" = 'FEMALE'
WHERE "code" = 'MATERNITY' AND "appliesTo" = 'ALL';
