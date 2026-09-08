-- AlterTable
ALTER TABLE "Exit" ADD COLUMN     "reversalReason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reversedAt" TIMESTAMPTZ(3),
ADD COLUMN     "reversedById" TEXT,
ADD COLUMN     "reversedByName" TEXT NOT NULL DEFAULT '';
