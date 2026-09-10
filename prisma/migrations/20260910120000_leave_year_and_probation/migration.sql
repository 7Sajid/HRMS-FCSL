-- Leave years run from each person's joining date, and a leave type says what
-- happens to it during probation. Decided with FCSL on 10 September 2026.

-- 1. The setting.
CREATE TYPE "ProbationLeave" AS ENUM ('NORMAL', 'ADVANCE', 'AFTER_PROBATION');
ALTER TABLE "LeaveType" ADD COLUMN "probation" "ProbationLeave" NOT NULL DEFAULT 'NORMAL';

-- Casual and sick leave can be taken during probation and come out of the
-- first permanent year; earned leave waits until probation ends. Set here for
-- installations that already exist; prisma/seed.ts sets it for new ones. The
-- column is new, so there is no choice of anybody's to overwrite.
UPDATE "LeaveType" SET "probation" = 'ADVANCE' WHERE "code" IN ('CASUAL', 'SICK');
UPDATE "LeaveType" SET "probation" = 'AFTER_PROBATION' WHERE "code" = 'EARNED';

-- 2. FCSL's own figures: casual 6, sick 6, and earned leave that does not
-- carry forward.
--
-- These rows are corrected in place rather than superseded by a new dated rule,
-- a deliberate exception to "rules are added, never edited". They are the
-- installation's placeholders — the Labour Act floor the system shipped with
-- until FCSL gave its figures — not a policy anybody's leave was decided under:
-- no leave had been granted on the live installation when this was written. A
-- rule dated today would instead leave every leave year that began before today
-- on the placeholder until that person's next anniversary.
--
-- Guarded on the shipped values, so a rule an HR Head entered is never touched.
UPDATE "LeaveTypeRule" r SET "daysPerYear" = 6
FROM "LeaveType" t
WHERE r."leaveTypeId" = t."id" AND t."code" = 'CASUAL'
  AND r."createdByName" = 'Installation' AND r."effectiveFrom" = DATE '2000-01-01'
  AND r."daysPerYear" = 10;

UPDATE "LeaveTypeRule" r SET "daysPerYear" = 6
FROM "LeaveType" t
WHERE r."leaveTypeId" = t."id" AND t."code" = 'SICK'
  AND r."createdByName" = 'Installation' AND r."effectiveFrom" = DATE '2000-01-01'
  AND r."daysPerYear" = 14;

UPDATE "LeaveTypeRule" r SET "carryForward" = false, "carryForwardCap" = NULL
FROM "LeaveType" t
WHERE r."leaveTypeId" = t."id" AND t."code" = 'EARNED'
  AND r."createdByName" = 'Installation' AND r."effectiveFrom" = DATE '2000-01-01'
  AND r."carryForward" = true AND r."carryForwardCap" = 40;

-- 3. Grants cut on calendar years.
--
-- The system creates grants and carry-forwards itself, the first time somebody's
-- leave is read. Those it cut on 1 January boundaries are removed where nothing
-- has been drawn from them, and are recreated on the new boundaries — with the
-- new figures — the next time that person's leave is read.
--
-- Nothing a person decided is touched: HR's ADJUSTMENT rows stay, and so does
-- any bucket that leave has already been taken from.
DELETE FROM "LeaveEntitlement" e
WHERE e."source" IN ('GRANT', 'CARRY_FORWARD')
  AND e."createdByName" = 'System'
  AND NOT EXISTS (SELECT 1 FROM "LeaveDayEntitlement" j WHERE j."entitlementId" = e."id");
