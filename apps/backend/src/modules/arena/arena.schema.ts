import { z } from 'zod';
import { SessionMetricsSchema, SessionStatusSchema } from '@/modules/sessions/sessions.schema.js';
import { RaceSnapshotSchema } from '../sessions/race/race.schema.js';
import { AGENT_OUTCOME_KINDS, AGENT_OUTCOME_VALUES, WS_EVENT_TYPES } from './arena.constants.js';

const AgentActSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
});

export const AgentStepPayloadSchema = z.object({
  step: z.number().int().nonnegative(),
  ts: z.number(),
  reflection: z.string(),
  think: z.string(),
  speak: z.string(),
  act: AgentActSchema,
  raw: z.string().optional(),
  thought: z.string().optional(),
  action_type: z.string().optional(),
  action_inputs: z.record(z.string(), z.unknown()).optional(),
  action_explanation: z.string().optional(),
});

export const AgentOutcomePayloadSchema = z.object({
  step: z.number().int().nonnegative(),
  ts: z.union([z.number(), z.string()]),
  kind: z.enum(AGENT_OUTCOME_KINDS),
  value: z.enum(AGENT_OUTCOME_VALUES),
  speak: z.string().optional(),
});

export const AgentErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
  fatal: z.boolean(),
  step: z.number().int().nonnegative().nullish(),
  ts: z.union([z.number(), z.string()]).nullish(),
});

export const ClientEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(WS_EVENT_TYPES.METRICS_UPDATE),
    payload: SessionMetricsSchema,
  }),
  z.object({
    type: z.literal(WS_EVENT_TYPES.STATUS_CHANGE),
    payload: z.object({ status: SessionStatusSchema, connectArgs: z.string().nullish() }),
  }),
  z.object({
    type: z.literal(WS_EVENT_TYPES.STEP_COMPLETE),
    payload: z.object({
      stepIndex: z.number().int().nonnegative(),
      description: z.string(),
    }),
  }),
  z.object({
    type: z.literal(WS_EVENT_TYPES.AGENT_THOUGHT),
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
    type: z.literal(WS_EVENT_TYPES.AGENT_STEP),
    payload: AgentStepPayloadSchema,
  }),
  z.object({
    type: z.literal(WS_EVENT_TYPES.AGENT_OUTCOME),
    payload: AgentOutcomePayloadSchema,
  }),
  z.object({
    type: z.literal(WS_EVENT_TYPES.AGENT_ERROR),
    payload: AgentErrorPayloadSchema,
  }),
]);

export const WsEventSchema = z.discriminatedUnion('type', [
  ...ClientEventSchema.options,
  z.object({ type: z.literal('RACE_STATE'), payload: z.object({
    sessionId: z.string(), revision: z.number().int().nonnegative(), status: SessionStatusSchema, race: RaceSnapshotSchema,
  }) }),
  z.object({ type: z.literal('RACE_ACTION'), payload: z.object({ sessionId: z.string(), action: z.object({
    id: z.string(), sessionId: z.string(), sequence: z.number().int().positive(), participant: z.enum(['HUMAN', 'AGENT']),
    eventId: z.string(), occurredAt: z.string(), receivedAt: z.string(), kind: z.string(),
    details: z.record(z.string(), z.unknown()), text: z.string().nullable(), step: z.number().int().nonnegative().nullable(),
  }) }) }),
]);
