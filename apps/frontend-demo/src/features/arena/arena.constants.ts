export const PREPARING_STEPS = [
  { label: 'Инициализация виртуальной машины', duration: 2000 },
  { label: 'Загрузка операционной системы', duration: 2500 },
  { label: 'Запуск графической оболочки', duration: 2000 },
  { label: 'Подключение к агенту', duration: 1500 },
  { label: 'Установка сессии Guacamole', duration: 2000 },
] as const;

export const SESSION_STATUSES = {
  PENDING: 'PENDING',
  PREPARING: 'PREPARING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export const WS_EVENT_TYPES = {
  METRICS_UPDATE: 'METRICS_UPDATE',
  STATUS_CHANGE: 'STATUS_CHANGE',
  STEP_COMPLETE: 'STEP_COMPLETE',
  AGENT_THOUGHT: 'AGENT_THOUGHT',
  AGENT_OUTCOME: 'AGENT_OUTCOME',
} as const;
