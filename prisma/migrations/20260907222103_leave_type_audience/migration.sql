-- CreateEnum
CREATE TYPE "LeaveAudience" AS ENUM ('ALL', 'FEMALE', 'MALE');

-- AlterTable
ALTER TABLE "LeaveType" ADD COLUMN     "appliesTo" "LeaveAudience" NOT NULL DEFAULT 'ALL';
