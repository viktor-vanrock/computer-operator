import { RaceSnapshotSchema } from './race.schema.js';
import type { RaceSnapshot, RawRaceState } from './race.types.js';

export function serializeRace(state: RawRaceState): RaceSnapshot {
  const race = state.race;
  if (!race) throw new Error('RACE_STATE_MISSING');
  return RaceSnapshotSchema.parse({
    autoFinishOnAgent: race.autoFinishOnAgent,
    revision: race.revision, startedAt: race.startedAt?.toISOString() ?? null, finishedAt: race.finishedAt?.toISOString() ?? null,
    winner: race.winner, finishReason: race.finishReason, cleanupStatus: race.cleanupStatus,
    errorCode: race.errorCode, errorMessage: race.errorMessage, taskTitle: race.taskTitle,
    modelId: race.modelId, modelLabel: race.modelLabel, lastEventSequence: race.nextEventSequence - 1,
    participants: [...race.participants].sort((a) => a.participant === 'HUMAN' ? -1 : 1).map((p) => {
      const elapsedMs = race.startedAt ? Math.max(0, (p.endedAt?.getTime() ?? Date.now()) - race.startedAt.getTime()) : null;
      return {
        participant: p.participant, status: p.status,
        connectArgs: race.finishedAt ? null : p.connectArgs,
        readyAt: p.readyAt?.toISOString() ?? null, endedAt: p.endedAt?.toISOString() ?? null,
        metrics: {
          elapsedMs, time: elapsedMs === null ? null : Math.floor(elapsedMs / 1000),
          steps: p.steps, clicks: p.clicks, lastStep: p.lastStep, eventCount: p.eventCount,
        },
      };
    }),
  });
}
