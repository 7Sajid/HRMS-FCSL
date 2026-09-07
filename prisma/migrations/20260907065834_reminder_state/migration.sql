-- CreateTable
CREATE TABLE "ReminderState" (
    "key" TEXT NOT NULL,
    "lastSentOn" DATE NOT NULL,
    "lastRung" TEXT NOT NULL DEFAULT '',
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReminderState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ReminderState_lastSentOn_idx" ON "ReminderState"("lastSentOn");
