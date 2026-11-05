-- Remove records that cannot be represented after dropping the SPLIT enum value.
-- Dependent SessionMetrics rows are removed by their ON DELETE CASCADE relation.
DELETE FROM "Session" WHERE "mode" = 'SPLIT';

-- Remove the SPLIT-only data model.
DROP TABLE IF EXISTS "LeaderboardEntry";

ALTER TABLE "Session"
  DROP COLUMN IF EXISTS "agentRightModel",
  DROP COLUMN IF EXISTS "agentLeftTaskUuid",
  DROP COLUMN IF EXISTS "agentRightTaskUuid",
  DROP COLUMN IF EXISTS "agentLeftJobId",
  DROP COLUMN IF EXISTS "agentRightJobId",
  DROP COLUMN IF EXISTS "connectArgsLeft",
  DROP COLUMN IF EXISTS "connectArgsRight",
  DROP COLUMN IF EXISTS "vmNameLeft",
  DROP COLUMN IF EXISTS "vmNameRight",
  DROP COLUMN IF EXISTS "guacIdLeft",
  DROP COLUMN IF EXISTS "guacIdRight",
  DROP COLUMN IF EXISTS "guacAuthTokenLeft",
  DROP COLUMN IF EXISTS "guacAuthTokenRight",
  DROP COLUMN IF EXISTS "sharingProfileIdLeft",
  DROP COLUMN IF EXISTS "sharingProfileIdRight",
  DROP COLUMN IF EXISTS "winnerId";

-- PostgreSQL enum values cannot be dropped in place, so recreate both enums.
ALTER TYPE "SessionMode" RENAME TO "SessionMode_old";
CREATE TYPE "SessionMode" AS ENUM ('SOLO', 'FULL_DUPLEX');
ALTER TABLE "Session"
  ALTER COLUMN "mode" DROP DEFAULT,
  ALTER COLUMN "mode" TYPE "SessionMode" USING ("mode"::text::"SessionMode"),
  ALTER COLUMN "mode" SET DEFAULT 'SOLO';
DROP TYPE "SessionMode_old";

DELETE FROM "SessionMetrics" WHERE "participant" IN ('AGENT_LEFT', 'AGENT_RIGHT');
ALTER TYPE "Participant" RENAME TO "Participant_old";
CREATE TYPE "Participant" AS ENUM ('HUMAN', 'AGENT');
ALTER TABLE "SessionMetrics"
  ALTER COLUMN "participant" TYPE "Participant" USING ("participant"::text::"Participant");
DROP TYPE "Participant_old";

-- Task descriptions must remain unrestricted text. This removes a VARCHAR(n)
-- length constraint on installations where the column was introduced that way.
ALTER TABLE "Task" ALTER COLUMN "title" TYPE TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'Task'
      AND column_name = 'description'
  ) THEN
    ALTER TABLE "Task" ALTER COLUMN "description" TYPE TEXT;
  END IF;
END $$;
