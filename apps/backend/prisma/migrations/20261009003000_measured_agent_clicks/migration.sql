-- Agent clicks are measured from executed actions. Preserve all state/nonnegative
-- constraints and the terminal result immutability trigger; do not rewrite history.
ALTER TABLE "RaceParticipant" DROP CONSTRAINT "RaceParticipant_state_check";
ALTER TABLE "RaceParticipant" ADD CONSTRAINT "RaceParticipant_state_check" CHECK (
  "status" IN ('WAITING', 'READY', 'RUNNING', 'SUCCEEDED', 'STOPPED', 'FAILED')
  AND ("steps" IS NULL OR "steps" >= 0) AND ("clicks" IS NULL OR "clicks" >= 0)
  AND ("lastStep" IS NULL OR "lastStep" >= 0) AND "eventCount" >= 0
  AND ("participant" <> 'HUMAN' OR "lastStep" IS NULL)
);
