import type { RaceSnapshot } from '../arena-human-agent/race-state';

import type { Difficulty } from './task.types';

export type SessionMode = 'SOLO' | 'FULL_DUPLEX' | 'HUMAN_VS_AGENT';
export type SessionStatus = 'PENDING' | 'PREPARING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type Participant = 'HUMAN' | 'AGENT';

export interface SessionMetrics {
  participant: Participant
  time: number    // миллисекунды
  steps: number
  clicks: number
  errors: number
  retries: number
}

export interface Session {
  id: string
  taskId: string | null
  mode: SessionMode
  status: SessionStatus
  difficulty: Difficulty
  connectArgs: string | null
  vmName: string | null
  guacId: string | null
  arenaOs: string | null
  customImageId: string | null
  resolvedImageId?: string | null
  historyMaxStepsCount: number | null
  maxScreenshotsDelay: number | null
  maxIterations: number | null
  modelRetries: number | null
  mouseClickDelay: number | null
  minOperationDelay: number | null
  agentLeftModel: string | null
  agentTaskUuid: string | null
  agentJobId: string | null
  sharingProfileId: string | null
  restartedFromSessionId?: string | null
  metrics: SessionMetrics[]
  race?: RaceSnapshot | null
  createdAt: string
  updatedAt: string
}

export interface CreateSessionInput {
  autoFinishOnAgent?: boolean
  taskId?: string
  mode: SessionMode
  difficulty: Difficulty
  arenaOs?: string
  customImageId?: string
  agentLeftModel?: string
  historyMaxStepsCount?: number
  maxScreenshotsDelay?: number
  maxIterations?: number
  modelRetries?: number
  mouseClickDelay?: number
  minOperationDelay?: number
}

export interface UpdateSessionInput {
  status?: SessionStatus
  metrics?: SessionMetrics[]
}
