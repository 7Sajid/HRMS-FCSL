-- The permanent record is append-only, and that is enforced HERE, by the
-- database, rather than by discipline in the application.
--
-- §6 of the specification promises: "Every action that changes something, or
-- reveals somebody's private information, writes one line that can never be
-- edited or deleted — not by HR, not by the Super Admin, not by the person who
-- built the software."
--
-- An application-level rule cannot make that promise. Anyone with the database
-- URL — a future developer, a migration script, a support session, whoever
-- holds the service role key — can bypass it in one statement. A trigger
-- cannot be bypassed by any of them.
--
-- This is also the answer to the question an auditor actually asks, which is
-- not "do you have a log" but "what stops somebody editing it".
--
-- Note this migration is hand-written and is NOT derivable from
-- prisma/schema.prisma. `prisma db push` would silently drop it, which is why
-- that command is banned in CLAUDE.md.

CREATE OR REPLACE FUNCTION "audit_event_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

DROP TRIGGER IF EXISTS "audit_event_no_update" ON "AuditEvent";

CREATE TRIGGER "audit_event_no_update"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_append_only"();

-- TRUNCATE takes no row-level trigger, so it needs its own statement-level one.
-- Without this, `TRUNCATE "AuditEvent"` empties the entire permanent record
-- without firing anything above.
DROP TRIGGER IF EXISTS "audit_event_no_truncate" ON "AuditEvent";

CREATE TRIGGER "audit_event_no_truncate"
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_event_append_only"();
