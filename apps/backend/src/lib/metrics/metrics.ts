import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Синглтон бизнес-метрик для Prometheus.
 * Все метрики регистрируются в globalRegistry prom-client.
 * Экспортируются именованными константами для инструментирования сервисов.
 */

// ─── Счётчики ────────────────────────────────────────────────────────────────

export const sessionsCreatedTotal = new Counter({
  name: 'sessions_created_total',
  help: 'Total number of sessions created',
  labelNames: ['mode', 'difficulty'] as const,
});

export const sessionsCompletedTotal = new Counter({
  name: 'sessions_completed_total',
  help: 'Total number of successfully completed sessions',
  labelNames: ['mode'] as const,
});

export const sessionsFailedTotal = new Counter({
  name: 'sessions_failed_total',
  help: 'Total number of failed sessions',
  labelNames: ['reason'] as const,
});

// ─── Gauges ──────────────────────────────────────────────────────────────────

export const sessionsActive = new Gauge({
  name: 'sessions_active',
  help: 'Current number of RUNNING sessions',
});

export const wsConnectionsActive = new Gauge({
  name: 'ws_connections_active',
  help: 'Current number of open WebSocket connections',
});

// ─── Histograms ──────────────────────────────────────────────────────────────

export const agentStartDurationSeconds = new Histogram({
  name: 'agent_start_duration_seconds',
  help: 'Time from startAgent call to receiving streamUrl',
  buckets: [1, 5, 10, 30, 60, 120, 300],
});

export const sessionDurationSeconds = new Histogram({
  name: 'session_duration_seconds',
  help: 'Full session duration from start to complete/fail',
  buckets: [30, 60, 120, 300, 600, 1200, 1800],
});

// ─── In-memory хранилище startedAt для расчёта длительности сессии ───────────

const sessionStartTimes = new Map<string, number>();

export const metricsService = {
  /** Запомнить время старта сессии (при переходе в RUNNING) */
  recordSessionStart(sessionId: string): void {
    sessionStartTimes.set(sessionId, Date.now());
  },

  /** Вернуть время старта сессии в секундах, удалить запись */
  consumeSessionStart(sessionId: string): number | undefined {
    const startMs = sessionStartTimes.get(sessionId);
    sessionStartTimes.delete(sessionId);
    if (startMs === undefined) return undefined;
    return (Date.now() - startMs) / 1000;
  },
};

/** Экспортируем тип реестра для удобства тестирования */
export type { Registry };
