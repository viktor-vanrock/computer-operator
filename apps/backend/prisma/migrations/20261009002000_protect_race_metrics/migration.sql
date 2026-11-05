-- Cleanup may clear connection credentials and record cleanedAt, but terminal
-- participant measurements/status are the immutable result of the race.
CREATE FUNCTION protect_race_participant_result() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SessionRace" WHERE "sessionId" = OLD."sessionId" AND "finishedAt" IS NOT NULL)
    AND OLD."endedAt" IS NOT NULL AND (
      NEW."steps" IS DISTINCT FROM OLD."steps" OR NEW."clicks" IS DISTINCT FROM OLD."clicks"
      OR NEW."lastStep" IS DISTINCT FROM OLD."lastStep" OR NEW."eventCount" IS DISTINCT FROM OLD."eventCount"
      OR NEW."endedAt" IS DISTINCT FROM OLD."endedAt" OR NEW."status" IS DISTINCT FROM OLD."status"
    ) THEN RAISE EXCEPTION 'Race participant result is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "RaceParticipant_immutable_result" BEFORE UPDATE ON "RaceParticipant"
FOR EACH ROW EXECUTE FUNCTION protect_race_participant_result();
