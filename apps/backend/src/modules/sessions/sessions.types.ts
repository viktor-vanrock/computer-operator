import { OS_OPTIONS, MODEL_OPTIONS } from './sessions.constants.js';
import type {
  CreateSessionSchema,
  ParticipantSchema,
  SessionMetricsSchema,
  SessionModeSchema,
  SessionSchema,
  SessionStatusSchema,
  UpdateSessionSchema,
} from './sessions.schema.js';
import type { z } from 'zod';


export type SessionMode = z.infer<typeof SessionModeSchema>;
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
export type Participant = z.infer<typeof ParticipantSchema>;
export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type UpdateSessionInput = z.infer<typeof UpdateSessionSchema>;

export interface RawSession {
  id: string;
  taskId: string | null;
  mode: string;
  status: string;
  difficulty: number;
  connectArgs: string | null;
  guacAuthToken: string | null;
  guacTunnelId: string | null;
  vmName: string | null;
  guacId: string | null;
  agentTaskUuid: string | null;
  agentJobId: string | null;
  arenaOs: string | null;
  customImageId: string | null;
  historyMaxStepsCount: number | null;
  maxScreenshotsDelay: number | null;
  maxIterations: number | null;
  modelRetries: number | null;
  mouseClickDelay: number | null;
  minOperationDelay: number | null;
  agentLeftModel: string | null;
  sharingProfileId: string | null;
  restartedFromSessionId: string | null;
  race?: import('./race/race.types.js').RaceSnapshot | null;
  metrics: RawMetrics[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RawMetrics {
  participant: string;
  time: number;
  steps: number;
  clicks: number;
  errors: number;
  retries: number;
}

export type OsOption = (typeof OS_OPTIONS)[keyof typeof OS_OPTIONS];
export type ModelOption = (typeof MODEL_OPTIONS)[number];
