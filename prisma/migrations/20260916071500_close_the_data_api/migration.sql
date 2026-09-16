-- Shut the Data API's door on every table (16 September 2026).
--
-- Supabase warned that the tables were "publicly accessible", and they were.
-- A GET to /rest/v1/User carrying the project's publishable key returned 200
-- and real rows. The grant on all 42 tables was `arwdDxtm` to `anon` and
-- `authenticated` — read, insert, update, delete, truncate — with row level
-- security off and no policies. Employee records, bank details, password
-- hashes and live session rows were all readable and writable by anyone who
-- had the project URL, and the publishable key is published by design.
--
-- The grants were never written here. Supabase ships
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,
-- authenticated, service_role`, so every table any migration has ever created
-- was handed to the API the moment it existed, and every future one would be.
--
-- This system never speaks to PostgREST. It reaches Postgres directly through
-- Prisma as `postgres`, which owns these tables. So the fix is to take the
-- grant away rather than to write policies: there is no Supabase-authenticated
-- user here for a policy to describe, and a policy per table would be 42
-- chances to get one wrong.
--
-- Two layers, because the first one is a default that a later CREATE TABLE
-- could quietly restore:
--
--   1. no grant to anon or authenticated, on today's tables and on tables not
--      yet written
--   2. RLS on with no policies, which denies every role that is neither the
--      owner nor BYPASSRLS even if a grant comes back
--
-- Neither layer touches the application. Checked before writing this rather
-- than assumed: pg_stat_activity shows the app arriving through Supavisor as
-- `postgres`, which owns all 42 tables and has rolbypassrls, and a table owner
-- is exempt from RLS unless FORCE is set, which is deliberately not set below.
--
-- service_role keeps its grant. It is the secret key — never shipped to a
-- browser — and the Supabase dashboard's own table editor reads through it.

-- The local development and QA databases are plain Postgres with none of these
-- roles, so the grants are only revoked where they exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN

    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated';

    -- The important half. Without this, the next migration that adds a table
    -- republishes it and we are back where we started, with nothing to say so.
    -- This only clears the defaults `postgres` granted, which is the only role
    -- migrations create tables as.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated';
  END IF;
END $$;

-- Layer two. Every table, including _prisma_migrations, and written as a loop
-- so that it covers the tables that exist rather than a list copied from the
-- schema that would rot the first time somebody added a model.
--
-- ENABLE, not FORCE: the owner must keep reading and writing, because the
-- owner is the application.
DO $$
DECLARE
  target regclass;
BEGIN
  FOR target IN
    SELECT c.oid::regclass
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  END LOOP;
END $$;

-- The same warning's second finding. A function with a mutable search_path can
-- be pointed at objects its caller chose. This one only raises an exception and
-- names no object, so there is nothing to point anywhere, but an empty
-- search_path costs a line and settles the question for whoever reads the
-- advisor next.
ALTER FUNCTION "audit_event_append_only"() SET search_path = '';
