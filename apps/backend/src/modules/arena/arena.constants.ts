export const WS_EVENT_TYPES = {
  RACE_STATE: 'RACE_STATE',
  RACE_ACTION: 'RACE_ACTION',
  METRICS_UPDATE: 'METRICS_UPDATE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  STEP_COMPLETE: 'STEP_COMPLETE',
  AGENT_THOUGHT: 'AGENT_THOUGHT',
  AGENT_STEP: 'AGENT_STEP',
  AGENT_OUTCOME: 'AGENT_OUTCOME',
  AGENT_ERROR: 'AGENT_ERROR',
} as const;

export const WS_ERROR_CODES = {
  INVALID_EVENT: 'INVALID_EVENT',
} as const;

export const AGENT_OUTCOME_KINDS = ['finished', 'aborted'] as const;
export const AGENT_OUTCOME_VALUES = ['positive', 'negative', 'user', 'env'] as const;
