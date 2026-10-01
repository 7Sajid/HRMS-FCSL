-- The Super Admin says whether leave is paid (FCSL, 1 October 2026).
--
-- His decision on every application, from anybody — probationer, permanent,
-- intern. Until now the leave TYPE decided it on its own: casual, sick and
-- earned always came off the balance, "leave without pay" never did, and
-- nobody could approve a day off for somebody still on probation without
-- spending entitlement that person had not earned yet.
--
-- Paid leave comes off the balance exactly as before. Unpaid leave is still
-- recorded — the absence happened, the calendar and the attendance sheet must
-- show it — but no LeaveDayEntitlement row is written, so it is deducted from
-- nothing.
--
-- This is what completes FCSL's probation rule. Somebody who joined in January
-- 2025 and took two paid days before their year was up has four casual days
-- left in their first permanent year; if those two days were granted without
-- pay, they have all six.

ALTER TABLE "LeaveRequest" ADD COLUMN "paid" BOOLEAN;

-- Everything already granted consumed entitlement, which is the definition of
-- paid here. Saying so on the row is better than leaving a null that a later
-- report would have to guess at.
UPDATE "LeaveRequest" SET "paid" = true WHERE "status" = 'GRANTED';
