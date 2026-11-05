ALTER TABLE "Task"
ADD COLUMN "prompt" TEXT NOT NULL DEFAULT '',
ADD COLUMN "isVisible" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Task" SET "prompt" = "title" WHERE "prompt" = '';

ALTER TABLE "Task"
ALTER COLUMN "prompt" DROP DEFAULT,
DROP COLUMN "estimatedHumanTime";
