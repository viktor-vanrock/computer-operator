-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "guacAuthTokenLeft" TEXT,
ADD COLUMN     "guacAuthTokenRight" TEXT,
ADD COLUMN     "guacIdLeft" TEXT,
ADD COLUMN     "guacIdRight" TEXT,
ADD COLUMN     "vmNameLeft" TEXT,
ADD COLUMN     "vmNameRight" TEXT;
