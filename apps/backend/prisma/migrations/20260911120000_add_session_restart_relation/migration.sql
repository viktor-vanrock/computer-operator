ALTER TABLE "Session" ADD COLUMN "restartedFromSessionId" TEXT;

CREATE UNIQUE INDEX "Session_restartedFromSessionId_key"
ON "Session"("restartedFromSessionId");

ALTER TABLE "Session"
ADD CONSTRAINT "Session_restartedFromSessionId_fkey"
FOREIGN KEY ("restartedFromSessionId") REFERENCES "Session"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
