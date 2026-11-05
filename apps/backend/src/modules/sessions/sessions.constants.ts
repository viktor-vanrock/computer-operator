import { env } from '@/lib/config/env.js';

export const SESSION_MODES = ['SOLO', 'FULL_DUPLEX', 'HUMAN_VS_AGENT'] as const;

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
export const SESSION_STATUSES = {
  PENDING: 'PENDING',
  PREPARING: 'PREPARING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export const PARTICIPANTS = ['HUMAN', 'AGENT'] as const;

export const OS_OPTIONS = {
  UBUNTU: 'ubuntu2204',
} as const;

export type OsOption = (typeof OS_OPTIONS)[keyof typeof OS_OPTIONS];

// image-id, который резервируется из пула VM Fleet по умолчанию для каждой ОС —
// используется, если пользователь не указал свой customImageId явно. Типизация
// Record<OsOption, string> заставляет добавить запись сюда при появлении новой ОС
// в OS_OPTIONS — иначе tsc не соберётся.
export const DEFAULT_IMAGE_BY_OS: Record<OsOption, string> = {
  [OS_OPTIONS.UBUNTU]: env.DEFAULT_IMAGE_ID,
};

export const MODEL_OPTIONS = [
  'computer-operator',
  'holo3',
  'qwen36',
  'ui-tars',
  'opencua',
  'evocua',
] as const;

export const POLL_INTERVAL_MS = 5_000;
export const PREPARING_TIMEOUT_MS = 60_000;

export const PRISMA_RECORD_NOT_EXIST_ERROR = 'P2025' as const;

export const FAILURE_REASONS = {
  VM_RESERVATION_EXHAUSTED: 'VM_RESERVATION_EXHAUSTED',
  ARENA_OS_UNMAPPED: 'ARENA_OS_UNMAPPED',
  GUACAMOLE_AUTH_FAILED: 'GUACAMOLE_AUTH_FAILED',
  GUACAMOLE_SHARING_FAILED: 'GUACAMOLE_SHARING_FAILED',
} as const;
