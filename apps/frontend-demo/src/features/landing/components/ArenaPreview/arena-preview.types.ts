export type Phase = 'running' | 'agent_wins';

export interface ArenaState {
  phase: Phase;
  elapsed: number;
  agentActionIdx: number;
  cycleKey: number;
}

export type ArenaAction =
  | { type: 'TICK' }
  | { type: 'AGENT_WINS' }
  | { type: 'RESTART' };
