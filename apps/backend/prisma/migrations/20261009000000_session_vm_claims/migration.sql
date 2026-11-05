CREATE TYPE "VmCleanupStatus" AS ENUM ('ACTIVE', 'PENDING', 'FAILED');
CREATE TYPE "VmAcquisitionStatus" AS ENUM ('PENDING', 'ASSIGNED', 'UNAVAILABLE', 'COMPENSATING', 'COMPLETE');

ALTER TABLE "Session"
  ADD COLUMN "resolvedImageId" TEXT,
  ADD COLUMN "creationKey" TEXT,
  ADD COLUMN "creationHash" TEXT;
CREATE UNIQUE INDEX "Session_creationKey_key" ON "Session"("creationKey");

CREATE TABLE "ActiveVmClaim" (
  "vmName" TEXT NOT NULL PRIMARY KEY,
  "vmId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "participant" "Participant" NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cleanupStatus" "VmCleanupStatus" NOT NULL DEFAULT 'ACTIVE',
  "cleanupAttempts" INTEGER NOT NULL DEFAULT 0 CHECK ("cleanupAttempts" >= 0),
  "nextRetryAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  CONSTRAINT "ActiveVmClaim_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ActiveVmClaim_vmId_key" ON "ActiveVmClaim"("vmId");
CREATE UNIQUE INDEX "ActiveVmClaim_sessionId_participant_key" ON "ActiveVmClaim"("sessionId", "participant");
CREATE INDEX "ActiveVmClaim_cleanupStatus_nextRetryAt_idx" ON "ActiveVmClaim"("cleanupStatus", "nextRetryAt");

CREATE TABLE "VmAcquisitionAttempt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sessionId" TEXT NOT NULL,
  "participant" "Participant" NOT NULL,
  "candidateVmId" TEXT NOT NULL,
  "candidateVmName" TEXT NOT NULL,
  "assignIdempotencyKey" TEXT NOT NULL,
  "status" "VmAcquisitionStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastErrorCode" TEXT,
  CONSTRAINT "VmAcquisitionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "VmAcquisitionAttempt_assignIdempotencyKey_key" ON "VmAcquisitionAttempt"("assignIdempotencyKey");
CREATE INDEX "VmAcquisitionAttempt_sessionId_status_idx" ON "VmAcquisitionAttempt"("sessionId", "status");
CREATE UNIQUE INDEX "VmAcquisitionAttempt_unresolved_vmId_key" ON "VmAcquisitionAttempt"("candidateVmId")
  WHERE "status" IN ('PENDING', 'ASSIGNED', 'COMPENSATING');
CREATE UNIQUE INDEX "VmAcquisitionAttempt_unresolved_vmName_key" ON "VmAcquisitionAttempt"("candidateVmName")
  WHERE "status" IN ('PENDING', 'ASSIGNED', 'COMPENSATING');
-- Existing Session_active_vmName_key remains in place. Runtime recovery validates
-- legacy VM identity before backfill; migration never invents an id from a name.
