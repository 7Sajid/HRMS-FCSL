-- Every requisition reaches the Super Admin, and then somebody actions it.
-- (FCSL, 1 October 2026.)
--
-- Two changes to §7.2, decided together:
--
-- 1. The ৳50,000 escalation threshold is gone. A requisition used to stop at
--    the HR Head unless it was expensive; now every one of them travels
--    manager → HR Head → Super Admin. The Requisition.escalationThreshold
--    column stays, because the rows that carry a number travelled a chain that
--    number chose and the record has to be able to explain its own route, but
--    nothing branches on it any more and new rows leave it null. The setting
--    row is deleted rather than left sitting in the HR Head's settings screen
--    quietly meaning nothing.
--
-- 2. An approved requisition now has somewhere to go. The HR Head names the
--    department that will action it as they approve — IT hand over the laptop,
--    Accounts pay the money — and when the Super Admin gives the final
--    approval that department's head is told, sees it on their own page, and
--    marks it done.
--
-- The head is a column on Department, not a new role. FCSL asked for an
-- Accounts head and an IT head; a role for each would mean a new role every
-- time a department is created, each one needing its own row in the permission
-- table, the leave chain and every approval screen. A department head is a
-- manager with one more list, which is what Branch.branchManagerId already
-- does for a branch.

ALTER TABLE "Department" ADD COLUMN "headId" TEXT;

ALTER TABLE "Department" ADD CONSTRAINT "Department_headId_fkey"
  FOREIGN KEY ("headId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Requisition" ADD COLUMN "actionDepartmentId" TEXT;
ALTER TABLE "Requisition" ADD COLUMN "actionDepartmentName" TEXT NOT NULL DEFAULT '';

ALTER TABLE "Requisition" ADD CONSTRAINT "Requisition_actionDepartmentId_fkey"
  FOREIGN KEY ("actionDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The department head's "waiting for you" list reads exactly this pair.
CREATE INDEX "Requisition_status_actionDepartmentId_idx"
  ON "Requisition"("status", "actionDepartmentId");

-- Nothing reads it now, and a number on a settings screen that changes nothing
-- is worse than no number at all.
DELETE FROM "Setting" WHERE "key" = 'requisition.escalationThreshold';
