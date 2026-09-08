-- The longest leave application the system will take.
--
-- Seeded for new installations by prisma/seed.ts, and inserted here for the
-- ones that already exist — the seed runs at installation, not on deploy, so a
-- setting added later never reaches a live system by that route. The code
-- falls back to a year when the row is missing, so the behaviour was already
-- right; what was missing was the HR Head's ability to see or change it,
-- because the settings screen lists the rows that exist.
--
-- ON CONFLICT DO NOTHING: if somebody has already set a different number, it
-- is theirs and this must not overwrite it.
INSERT INTO "Setting" ("key", "value", "updatedByName", "updatedAt")
VALUES ('leave.maximumDays', '366', 'System', NOW())
ON CONFLICT ("key") DO NOTHING;
