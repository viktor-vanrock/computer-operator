import type { RaceAction, RaceSnapshot } from '../arena-human-agent/race-state';

import type { SessionMetrics, SessionStatus } from './session.types';

export type AgentThoughtEvent = {
  type: 'AGENT_THOUGHT'
  payload: {
    step: number
    ts: number
    text: string
    status: 'INCOMPLETE' | 'DONE' | 'FAILED' | 'CANCELLED'
    thought?: string
    action_type?: string
    action_inputs?: Record<string, unknown>
    action_explanation?: string
  }
};

export interface AgentStepPayload {
  step: number
  ts: number
  reflection: string
  think: string
  speak: string
  act: { name: string; arguments: Record<string, unknown> }
  raw?: string
  thought?: string
  action_type?: string
  action_inputs?: Record<string, unknown>
  action_explanation?: string
}

export interface AgentOutcomePayload {
  step: number
  ts: number | string
  kind: 'finished' | 'aborted'
  value: 'positive' | 'negative' | 'user' | 'env'
  speak?: string
}

export interface AgentErrorPayload {
  code: string
  message: string
  fatal: boolean
  step?: number | null
  ts?: number | string | null
}

export type AgentStepEvent = { type: 'AGENT_STEP'; payload: AgentStepPayload };
export type AgentOutcomeEvent = { type: 'AGENT_OUTCOME'; payload: AgentOutcomePayload };
export type AgentErrorEvent = { type: 'AGENT_ERROR'; payload: AgentErrorPayload };

export type WsEvent =
  | { type: 'RACE_STATE'; payload: { sessionId: string; revision: number; status: SessionStatus; race: RaceSnapshot } }
  | { type: 'RACE_ACTION'; payload: { sessionId: string; action: RaceAction } }
  | { type: 'METRICS_UPDATE'; payload: SessionMetrics }
  | { type: 'STATUS_CHANGE'; payload: { status: SessionStatus; connectArgs?: string | null } }
  | { type: 'STEP_COMPLETE'; payload: { stepIndex: number; description: string } }
  | AgentThoughtEvent
  | AgentStepEvent
  | AgentOutcomeEvent
  | AgentErrorEvent;
