-- AlterEnum: расширяем Participant новыми значениями для SPLIT-режима
ALTER TYPE "Participant" ADD VALUE IF NOT EXISTS 'AGENT_LEFT';
ALTER TYPE "Participant" ADD VALUE IF NOT EXISTS 'AGENT_RIGHT';

-- AlterTable: добавляем поля для агент-менеджера (SOLO) и SPLIT-режима
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "agentTaskUuid"      TEXT,
  ADD COLUMN IF NOT EXISTS "agentJobId"         TEXT,
  ADD COLUMN IF NOT EXISTS "arenaOs"            TEXT,
  ADD COLUMN IF NOT EXISTS "agentLeftModel"     TEXT,
  ADD COLUMN IF NOT EXISTS "agentRightModel"    TEXT,
  ADD COLUMN IF NOT EXISTS "agentLeftTaskUuid"  TEXT,
  ADD COLUMN IF NOT EXISTS "agentRightTaskUuid" TEXT,
  ADD COLUMN IF NOT EXISTS "agentLeftJobId"     TEXT,
  ADD COLUMN IF NOT EXISTS "agentRightJobId"    TEXT,
  ADD COLUMN IF NOT EXISTS "winnerId"           TEXT;

-- CreateTable: лидерборд моделей по результатам SPLIT-сессий
CREATE TABLE IF NOT EXISTS "LeaderboardEntry" (
    "id"         TEXT NOT NULL,
    "modelId"    TEXT NOT NULL,
    "wins"       INTEGER NOT NULL DEFAULT 0,
    "losses"     INTEGER NOT NULL DEFAULT 0,
    "totalRaces" INTEGER NOT NULL DEFAULT 0,
    "avgTime"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgSteps"   DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeaderboardEntry_modelId_key" ON "LeaderboardEntry"("modelId");
