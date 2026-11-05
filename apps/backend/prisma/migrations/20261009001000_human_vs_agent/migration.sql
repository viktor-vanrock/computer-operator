-- AlterEnum
ALTER TYPE "SessionMode" ADD VALUE 'HUMAN_VS_AGENT';

-- CreateTable
CREATE TABLE "SessionRace" (
    "sessionId" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "taskPrompt" TEXT NOT NULL,
    "resolvedImageId" TEXT NOT NULL,
    "modelId" TEXT DEFAULT 'computer-operator',
    "modelLabel" TEXT DEFAULT 'Computer Operator',
    "agentProfile" TEXT NOT NULL DEFAULT 'default',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "nextEventSequence" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "winner" "Participant",
    "finishReason" TEXT,
    "cleanupStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "errorCode" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "SessionRace_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "RaceParticipant" (
    "sessionId" TEXT NOT NULL,
    "participant" "Participant" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'WAITING',
    "vmName" TEXT,
    "guacId" TEXT,
    "connectArgs" TEXT,
    "guacAuthToken" TEXT,
    "guacTunnelId" TEXT,
    "sharingProfileId" TEXT,
    "agentTaskUuid" TEXT,
    "readyAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "cleanedAt" TIMESTAMP(3),
    "steps" INTEGER,
    "lastStep" INTEGER,
    "clicks" INTEGER,
    "eventCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RaceParticipant_pkey" PRIMARY KEY ("sessionId","participant")
);

-- CreateTable
CREATE TABLE "RaceAction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "participant" "Participant" NOT NULL,
    "eventId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "text" TEXT,
    "step" INTEGER,

    CONSTRAINT "RaceAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RaceAction_sessionId_sequence_key" ON "RaceAction"("sessionId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RaceAction_sessionId_participant_eventId_key" ON "RaceAction"("sessionId", "participant", "eventId");

-- AddForeignKey
ALTER TABLE "SessionRace" ADD CONSTRAINT "SessionRace_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceParticipant" ADD CONSTRAINT "RaceParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionRace"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceAction" ADD CONSTRAINT "RaceAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SessionRace"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SessionRace" ADD CONSTRAINT "SessionRace_state_check" CHECK (
  "revision" >= 0 AND "nextEventSequence" >= 1
  AND ("startedAt" IS NULL OR "finishedAt" IS NULL OR "finishedAt" >= "startedAt")
  AND ("winner" IS NULL OR ("startedAt" IS NOT NULL AND "finishedAt" IS NOT NULL
    AND (("winner" = 'HUMAN' AND "finishReason" = 'HUMAN_FINISHED')
      OR ("winner" = 'AGENT' AND "finishReason" = 'AGENT_FINISHED'))))
  AND "cleanupStatus" IN ('NOT_REQUIRED', 'PENDING', 'COMPLETE', 'FAILED')
);
ALTER TABLE "RaceParticipant" ADD CONSTRAINT "RaceParticipant_state_check" CHECK (
  "status" IN ('WAITING', 'READY', 'RUNNING', 'SUCCEEDED', 'STOPPED', 'FAILED')
  AND ("steps" IS NULL OR "steps" >= 0) AND ("clicks" IS NULL OR "clicks" >= 0)
  AND ("lastStep" IS NULL OR "lastStep" >= 0) AND "eventCount" >= 0
  AND ("participant" <> 'HUMAN' OR "lastStep" IS NULL)
  AND ("participant" <> 'AGENT' OR "clicks" IS NULL)
);
ALTER TABLE "RaceAction" ADD CONSTRAINT "RaceAction_sequence_check" CHECK ("sequence" >= 1);
CREATE FUNCTION protect_race_result() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."finishedAt" IS NOT NULL AND (
    NEW."finishedAt" IS DISTINCT FROM OLD."finishedAt" OR NEW."winner" IS DISTINCT FROM OLD."winner"
    OR NEW."finishReason" IS DISTINCT FROM OLD."finishReason" OR NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
  ) THEN RAISE EXCEPTION 'Race result is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "SessionRace_immutable_result" BEFORE UPDATE ON "SessionRace"
FOR EACH ROW EXECUTE FUNCTION protect_race_result();

ALTER TABLE "Session" ADD CONSTRAINT "Session_race_creation_check" CHECK (
  "mode"::text <> 'HUMAN_VS_AGENT' OR (
    "taskId" IS NOT NULL AND "creationKey" IS NOT NULL AND "creationHash" IS NOT NULL
    AND "vmName" IS NULL AND "guacId" IS NULL AND "connectArgs" IS NULL AND "agentTaskUuid" IS NULL
  )
);
