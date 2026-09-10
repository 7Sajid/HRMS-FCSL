-- A note is written for a day (FCSL, 10 September 2026): "I have a meeting after
-- 3 days with 2 persons, so I need to make notes [for] that date."
--
-- Notes that already exist take the Dhaka date they were written on, which is
-- as close to the day they were about as anybody can now tell.
ALTER TABLE "Note" ADD COLUMN "date" DATE;
UPDATE "Note" SET "date" = ("createdAt" AT TIME ZONE 'Asia/Dhaka')::date;
ALTER TABLE "Note" ALTER COLUMN "date" SET NOT NULL;

-- When the morning reminder went into the bell, so a retried nightly run does
-- not ring twice.
ALTER TABLE "Note" ADD COLUMN "remindedAt" TIMESTAMPTZ(3);

CREATE INDEX "Note_userId_date_idx" ON "Note"("userId", "date");
CREATE INDEX "Note_date_remindedAt_idx" ON "Note"("date", "remindedAt");
