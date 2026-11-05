-- AlterEnum
ALTER TYPE "SessionMode" ADD VALUE 'COOP';

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_taskId_fkey";

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "historyMaxStepsCount" INTEGER,
ADD COLUMN     "maxScreenshotsDelay" INTEGER,
ALTER COLUMN "taskId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
