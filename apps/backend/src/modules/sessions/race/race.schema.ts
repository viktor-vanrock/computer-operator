import { z } from 'zod';
import { BadRequestException } from '@/lib/http/errors.js';

const ParticipantSchema = z.enum(['HUMAN', 'AGENT']);
const coordinate = z.number().finite().min(0).max(1);
const point = z.strictObject({ x: coordinate, y: coordinate });
const button = z.enum(['left', 'middle', 'right']);
const eventBase = { eventId: z.uuid(), occurredAt: z.iso.datetime() };

export const HumanActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...eventBase, kind: z.literal('CLICK'), details: z.strictObject({
    x: coordinate, y: coordinate, button, count: z.number().int().min(1).max(3).optional(),
  }) }),
  z.strictObject({ ...eventBase, kind: z.literal('DRAG'), details: z.strictObject({ from: point, to: point, button }) }),
  z.strictObject({ ...eventBase, kind: z.literal('SCROLL'), details: z.strictObject({
    x: coordinate, y: coordinate, deltaX: z.number().finite(), deltaY: z.number().finite(),
  }) }),
  z.strictObject({ ...eventBase, kind: z.literal('KEY_INPUT'), details: z.strictObject({
    keysym: z.number().int().min(0).max(0xffffffff), modifiers: z.array(z.enum(['Shift', 'Ctrl', 'Alt', 'Meta'])).max(4)
      .refine((values) => new Set(values).size === values.length, 'Modifiers must be unique'),
    keysyms: z.array(z.number().int().min(0).max(0xffffffff)).min(1).max(128).optional(),
  }) }),
]);
export const HumanActionBatchSchema = z.strictObject({ events: z.array(HumanActionSchema).min(1).max(50) });
export const RaceActionPageSchema = z.object({
  afterSequence: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const RaceCreateSchema = z.object({
  autoFinishOnAgent: z.boolean().optional(),
  taskId: z.uuid(), difficulty: z.number().int().min(1).max(5),
  arenaOs: z.enum(['ubuntu2204']).optional(), customImageId: z.string().min(1).max(100).optional(),
  agentLeftModel: z.string().min(1).max(200).optional(),
  maxIterations: z.number().int().nonnegative().optional(), modelRetries: z.number().int().nonnegative().optional(),
  mouseClickDelay: z.number().finite().nonnegative().optional(), minOperationDelay: z.number().finite().nonnegative().optional(),
});
export const RaceMetricsSchema = z.object({
  elapsedMs: z.number().int().nonnegative().nullable(), time: z.number().int().nonnegative().nullable(),
  steps: z.number().int().nonnegative().nullable(), clicks: z.number().int().nonnegative().nullable(),
  lastStep: z.number().int().nonnegative().nullable(), eventCount: z.number().int().nonnegative(),
});
export const RaceParticipantSchema = z.object({
  participant: ParticipantSchema, status: z.enum(['WAITING', 'READY', 'RUNNING', 'SUCCEEDED', 'STOPPED', 'FAILED']),
  connectArgs: z.string().nullable(), readyAt: z.string().nullable(), endedAt: z.string().nullable(), metrics: RaceMetricsSchema,
});
export const RaceSnapshotSchema = z.object({
  autoFinishOnAgent: z.boolean().default(true),
  revision: z.number().int().nonnegative(), startedAt: z.string().nullable(), finishedAt: z.string().nullable(),
  winner: ParticipantSchema.nullable(), finishReason: z.enum([
    'HUMAN_FINISHED', 'AGENT_FINISHED', 'USER_STOP', 'PREPARATION_FAILED', 'START_FAILED',
    'AGENT_FAILED', 'CONNECTION_LOST', 'BACKEND_RESTART',
  ]).nullable(), cleanupStatus: z.enum(['NOT_REQUIRED', 'PENDING', 'COMPLETE', 'FAILED']),
  errorCode: z.string().nullable(), errorMessage: z.string().nullable(), taskTitle: z.string(),
  modelId: z.string().nullable(), modelLabel: z.string().nullable(), participants: z.array(RaceParticipantSchema).length(2),
  lastEventSequence: z.number().int().nonnegative(),
});

export function parseCreationKey(value: string | string[] | undefined, required: boolean): string | null {
  if (value === undefined) {
    if (required) throw new BadRequestException('IDEMPOTENCY_KEY_REQUIRED', 'IDEMPOTENCY_KEY_REQUIRED');
    return null;
  }
  if (typeof value !== 'string' || !z.uuid().safeParse(value).success) {
    throw new BadRequestException('IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_INVALID');
  }
  return value.toLowerCase();
}
