-- Divisions, above branches (FCSL, 2 October 2026).
--
-- FCSL's divisions are geographic: Dhaka is a division and several offices sit
-- under it, Chattogram is another. The Super Admin's monthly summary is read a
-- division at a time, as well as by branch, by department and by person.
--
-- The division goes on the BRANCH, not on the employee. A person's division
-- follows from where they work, so putting it on the employee would be a second
-- copy of the same fact — free to disagree with the first — and would need a
-- column in the 412-row import that nobody would think to fill in.
--
-- Seeded with Bangladesh's eight administrative divisions because that is the
-- real list and FCSL named two of them; the HR Head retires the ones FCSL has
-- no office in, the same as any other list.

CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "retiredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Division_name_key" ON "Division"("name");

-- Supabase's Data API would otherwise serve this table to anyone holding the
-- publishable key. See 20260916071500_close_the_data_api: the default privilege
-- is revoked, so a new table gets no grant, and RLS with no policy is the second
-- lock. ENABLE, never FORCE — the owner is the application.
ALTER TABLE "Division" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "Branch" ADD COLUMN "divisionId" TEXT;

ALTER TABLE "Branch" ADD CONSTRAINT "Branch_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Branch_divisionId_idx" ON "Branch"("divisionId");

INSERT INTO "Division" ("id", "name") VALUES
  (gen_random_uuid()::text, 'Dhaka'),
  (gen_random_uuid()::text, 'Chattogram'),
  (gen_random_uuid()::text, 'Khulna'),
  (gen_random_uuid()::text, 'Rajshahi'),
  (gen_random_uuid()::text, 'Barishal'),
  (gen_random_uuid()::text, 'Sylhet'),
  (gen_random_uuid()::text, 'Rangpur'),
  (gen_random_uuid()::text, 'Mymensingh')
ON CONFLICT ("name") DO NOTHING;
