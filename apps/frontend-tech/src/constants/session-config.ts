export const MODE_OPTIONS = [
  { value: 'SOLO', label: 'SOLO' },
  { value: 'HUMAN_VS_AGENT', label: 'Человек vs агент' },
  { value: 'FULL_DUPLEX', label: 'Full Duplex' },
] as const;

export const FULL_DUPLEX_DEFAULTS = {
  HISTORY_MAX_STEPS_COUNT: 20,
  MAX_SCREENSHOTS_DELAY: 10,
} as const;

export const SOLO_DEFAULTS = {
  MAX_ITERATIONS: 25,
  MODEL_RETRIES: 4,
  MOUSE_CLICK_DELAY: 0.1,
  MIN_OPERATION_DELAY: 2,
} as const;

export type SessionModeValue = (typeof MODE_OPTIONS)[number]['value'];
