export interface RevisionState { sessionId: string; revision: number }

export function reconcileRace<T extends RevisionState>(current: T | null, incoming: T): T {
  if (!current) return incoming;
  if (current.sessionId !== incoming.sessionId || current.revision >= incoming.revision) return current;
  return incoming;
}
import { z } from 'zod';

export const RaceSnapshotSchema = z.object({
  autoFinishOnAgent: z.boolean().optional(),
  revision: z.number().int().nonnegative(), startedAt: z.string().nullable(), finishedAt: z.string().nullable(),
  winner: z.enum(['HUMAN', 'AGENT']).nullable(), finishReason: z.string().nullable(),
  cleanupStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'COMPLETE', 'FAILED']), errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(), taskTitle: z.string(), modelId: z.string().nullable(), modelLabel: z.string().nullable(),
  lastEventSequence: z.number().int().nonnegative(), participants: z.array(z.object({
    participant: z.enum(['HUMAN', 'AGENT']), status: z.enum(['WAITING', 'READY', 'RUNNING', 'SUCCEEDED', 'STOPPED', 'FAILED']),
    connectArgs: z.string().nullable(), readyAt: z.string().nullable(), endedAt: z.string().nullable(),
    metrics: z.object({
      elapsedMs: z.number().int().nonnegative().nullable(), time: z.number().int().nonnegative().nullable(),
      steps: z.number().int().nonnegative().nullable(), clicks: z.number().int().nonnegative().nullable(),
      lastStep: z.number().int().nonnegative().nullable(), eventCount: z.number().int().nonnegative(),
    }),
  })).length(2),
});
export const RaceActionSchema = z.object({
  id: z.string(), sessionId: z.string(), sequence: z.number().int().positive(), participant: z.enum(['HUMAN', 'AGENT']),
  eventId: z.string(), occurredAt: z.string(), receivedAt: z.string(), kind: z.string(),
  details: z.record(z.string(), z.unknown()), text: z.string().nullable(), step: z.number().int().nonnegative().nullable(),
});
export type RaceSnapshot = z.infer<typeof RaceSnapshotSchema>;
export type RaceAction = z.infer<typeof RaceActionSchema>;
