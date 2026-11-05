-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('SOLO', 'SPLIT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'PREPARING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "Participant" AS ENUM ('HUMAN', 'AGENT');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "estimatedHumanTime" INTEGER NOT NULL,
    "isPreset" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "mode" "SessionMode" NOT NULL DEFAULT 'SOLO',
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "difficulty" INTEGER NOT NULL,
    "streamUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionMetrics" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participant" "Participant" NOT NULL,
    "time" INTEGER NOT NULL DEFAULT 0,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "retries" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SessionMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Score" (
    "id" TEXT NOT NULL,
    "humanTotal" INTEGER NOT NULL DEFAULT 0,
    "agentTotal" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Score_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_isPreset_idx" ON "Task"("isPreset");

-- CreateIndex
CREATE UNIQUE INDEX "Task_title_isPreset_key" ON "Task"("title", "isPreset");

-- CreateIndex
CREATE INDEX "Session_status_idx" ON "Session"("status");

-- CreateIndex
CREATE INDEX "Session_taskId_idx" ON "Session"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionMetrics_sessionId_participant_key" ON "SessionMetrics"("sessionId", "participant");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionMetrics" ADD CONSTRAINT "SessionMetrics_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
