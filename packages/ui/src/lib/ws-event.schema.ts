/**
 * Zod-схема для валидации WS-событий на клиенте.
 */
import { z } from 'zod';

import { RaceActionSchema, RaceSnapshotSchema } from '../arena-human-agent/race-state';

const SessionMetricsSchema = z.object({
  participant: z.enum(['HUMAN', 'AGENT']),
  time: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
});

export const WsEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('RACE_STATE'), payload: z.object({
    sessionId: z.string(), revision: z.number().int().nonnegative(),
    status: z.enum(['PENDING', 'PREPARING', 'RUNNING', 'COMPLETED', 'FAILED']), race: RaceSnapshotSchema,
  }) }),
  z.object({ type: z.literal('RACE_ACTION'), payload: z.object({ sessionId: z.string(), action: RaceActionSchema }) }),
  z.object({ type: z.literal('METRICS_UPDATE'), payload: SessionMetricsSchema }),
  z.object({ type: z.literal('STATUS_CHANGE'), payload: z.object({ status: z.enum(['PENDING', 'PREPARING', 'RUNNING', 'COMPLETED', 'FAILED']), connectArgs: z.string().nullish() }) }),
  z.object({ type: z.literal('STEP_COMPLETE'), payload: z.object({ stepIndex: z.number().int().nonnegative(), description: z.string() }) }),
  z.object({
    type: z.literal('AGENT_THOUGHT'),
    payload: z.object({
      step: z.number().int().nonnegative(),
      ts: z.number(),
      text: z.string(),
      status: z.enum(['INCOMPLETE', 'DONE', 'FAILED', 'CANCELLED']),
      thought: z.string().optional(),
      action_type: z.string().optional(),
      action_inputs: z.record(z.string(), z.unknown()).optional(),
      action_explanation: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('AGENT_STEP'),
    payload: z.object({
      step: z.number().int().nonnegative(),
      ts: z.number(),
      reflection: z.string(),
      think: z.string(),
      speak: z.string(),
      act: z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) }),
      raw: z.string().optional(),
      thought: z.string().optional(),
      action_type: z.string().optional(),
      action_inputs: z.record(z.string(), z.unknown()).optional(),
      action_explanation: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('AGENT_OUTCOME'),
    payload: z.object({
      step: z.number().int().nonnegative(),
      ts: z.union([z.number(), z.string()]),
      kind: z.enum(['finished', 'aborted']),
      value: z.enum(['positive', 'negative', 'user', 'env']),
      speak: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal('AGENT_ERROR'),
    payload: z.object({
      code: z.string(),
      message: z.string(),
      fatal: z.boolean(),
      step: z.number().int().nonnegative().nullish(),
      ts: z.union([z.number(), z.string()]).nullish(),
    }),
  }),
]);
