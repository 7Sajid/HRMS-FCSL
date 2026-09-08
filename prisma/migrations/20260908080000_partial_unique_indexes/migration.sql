-- The partial unique indexes.
--
-- CLAUDE.md has always said `prisma db push` is banned because "the audit
-- trigger and the partial unique indexes are hand-written SQL that db push
-- would silently drop". The trigger was written. The indexes never were, so
-- the ban was half justified by something that did not exist.
--
-- Both rules below were already enforced in application code, and both checks
-- run BEFORE their transaction opens — which is no enforcement at all when two
-- requests arrive together. Proven by inserting the duplicates directly: the
-- database accepted two open assignments of one terminal and two current
-- emergency contacts in one slot.
--
-- Prisma cannot express a partial index, which is precisely why these live in
-- hand-written SQL and why the ban on db push is real.

-- §6.9 — a trading terminal is held by one person at a time.
--
-- "Is anybody holding an active terminal whose certificate has expired?" is a
-- question a BSEC inspection asks, and it has no answer if a terminal can be
-- assigned to two people at once. Released assignments are unconstrained: the
-- history of who held what is meant to accumulate.
CREATE UNIQUE INDEX "TerminalAssignment_one_holder_at_a_time"
  ON "TerminalAssignment" ("terminalId")
  WHERE "releasedOn" IS NULL;

-- §5.1 — one current emergency contact per slot, and one pending change.
--
-- This is the page that matters on the worst day of somebody's career. Two
-- rows marked CURRENT means the system has two answers to "who do we ring",
-- and no way to say which is right. SUPERSEDED rows are unconstrained, because
-- keeping every previous version is the point.
CREATE UNIQUE INDEX "EmergencyContact_one_current_per_slot"
  ON "EmergencyContact" ("employeeId", "slot")
  WHERE "status" = 'CURRENT';

-- And one change waiting with HR at a time. The code already amends an
-- existing proposal rather than stacking a second one; this is what makes that
-- true rather than intended.
CREATE UNIQUE INDEX "EmergencyContact_one_pending_per_slot"
  ON "EmergencyContact" ("employeeId", "slot")
  WHERE "status" = 'PENDING';
