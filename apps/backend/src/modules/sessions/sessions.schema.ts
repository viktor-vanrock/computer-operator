import { z } from 'zod';
import { DifficultySchema } from '@/modules/tasks/tasks.schema.js';
import { RaceSnapshotSchema } from './race/race.schema.js';
import { OS_OPTIONS, PARTICIPANTS, SESSION_MODES, SESSION_STATUSES } from './sessions.constants.js';


export const SessionModeSchema = z.enum(SESSION_MODES);
export const SessionStatusSchema = z.enum(Object.values(SESSION_STATUSES));
export const ParticipantSchema = z.enum(PARTICIPANTS);

export const ArenaOsSchema = z.enum(Object.values(OS_OPTIONS));
export const ModelIdSchema = z.string().min(1).max(200);
export const CustomImageIdSchema = z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/, 'customImageId must match ^[a-zA-Z0-9._-]{1,100}$');

export const SessionMetricsSchema = z.object({
  participant: ParticipantSchema,
  time: z.number().int().nonnegative(),
  steps: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
});

export const SessionSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  mode: SessionModeSchema,
  status: SessionStatusSchema,
  difficulty: DifficultySchema,
  connectArgs: z.string().nullable(),
  guacAuthToken: z.string().nullable(),
  guacTunnelId: z.string().nullable(),
  vmName: z.string().nullable(),
  guacId: z.string().nullable(),
  agentTaskUuid: z.string().nullable(),
  agentJobId: z.string().nullable(),
  arenaOs: z.string().nullable(),
  customImageId: z.string().nullable(),
  resolvedImageId: z.string().nullable().optional(),
  historyMaxStepsCount: z.number().int().positive().nullable(),
  maxScreenshotsDelay: z.number().int().positive().nullable(),
  maxIterations: z.number().int().nonnegative().nullable(),
  modelRetries: z.number().int().nonnegative().nullable(),
  mouseClickDelay: z.number().finite().nonnegative().nullable(),
  minOperationDelay: z.number().finite().nonnegative().nullable(),
  agentLeftModel: z.string().nullable(),
  sharingProfileId: z.string().nullable(),
  restartedFromSessionId: z.string().uuid().nullable().optional(),
  metrics: z.array(SessionMetricsSchema),
  race: RaceSnapshotSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CreateSessionSchema = z.object({
  autoFinishOnAgent: z.boolean().optional(),
  taskId: z.string().uuid().optional(),
  mode: SessionModeSchema.default('SOLO'),
  difficulty: DifficultySchema,
  arenaOs: ArenaOsSchema.optional(),
  customImageId: CustomImageIdSchema.optional(),
  agentLeftModel: ModelIdSchema.optional(),
  historyMaxStepsCount: z.number().int().positive().optional(),
  maxScreenshotsDelay: z.number().int().positive().optional(),
  maxIterations: z.number().int().nonnegative().optional(),
  modelRetries: z.number().int().nonnegative().optional(),
  mouseClickDelay: z.number().finite().nonnegative().optional(),
  minOperationDelay: z.number().finite().nonnegative().optional(),
}).superRefine((data, ctx) => {
  if (data.mode !== 'HUMAN_VS_AGENT' && data.autoFinishOnAgent !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['autoFinishOnAgent'], message: 'Only applicable to HUMAN_VS_AGENT mode' });
  }
  if ('FULL_DUPLEX' !== data.mode && !data.taskId) {
    ctx.addIssue({ code: 'custom', path: ['taskId'], message: 'Required for SOLO' });
  }
  const soloOnlyFields = ['maxIterations', 'modelRetries', 'mouseClickDelay', 'minOperationDelay'] as const;
  if (data.mode === 'FULL_DUPLEX') {
    for (const field of soloOnlyFields) {
      if (data[field] != null) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'Only applicable to SOLO mode' });
      }
    }
  }
  if (data.mode !== 'FULL_DUPLEX' && !data.arenaOs && !data.customImageId) {
    ctx.addIssue({ code: 'custom', path: ['arenaOs'], message: 'arenaOs or customImageId required' });
  }
});

export const UpdateSessionSchema = z.object({
  status: SessionStatusSchema.optional(),
  metrics: z.array(SessionMetricsSchema).optional(),
});

export const NextTaskSchema = z.object({
  taskDescription: z.string().trim().min(1),
  validationToken: z.string().min(1).optional(),
});
