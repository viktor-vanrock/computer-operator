import { describe, expect, it, vi } from 'vitest';

// sessions.constants.ts читает env.DEFAULT_IMAGE_ID на уровне модуля —
// без мока реальный env.ts падает в process.exit(1), если .env не настроен (CI).
vi.mock('@/lib/config/env.js', () => ({
  env: { DEFAULT_IMAGE_ID: '8b2a638d-cdac-479e-9152-5d00b3164707', NODE_ENV: 'test' },
  isDev: false,
}));

import { WsEventSchema } from '@/modules/arena/arena.schema.js';
import { PARTICIPANTS, SESSION_MODES, SESSION_STATUSES } from '@/modules/sessions/sessions.constants.js';
import {
  CreateSessionSchema,
  ParticipantSchema,
  SessionMetricsSchema,
  SessionModeSchema,
  SessionSchema,
  SessionStatusSchema,
  UpdateSessionSchema,
} from '@/modules/sessions/sessions.schema.js';
import { DIFFICULTY_MAX, DIFFICULTY_MIN } from '@/modules/tasks/tasks.constants.js';
import { CreateTaskSchema, DifficultySchema, TaskSchema } from '@/modules/tasks/tasks.schema.js';

/* ── Fixtures ───────────────────────────────────────────────────────── */

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const VALID_METRICS = {
  participant: 'HUMAN' as const,
  time: 0,
  steps: 0,
  clicks: 0,
  errors: 0,
  retries: 0,
};

/* ================================================================== */
/* tasks                                                                */
/* ================================================================== */

describe('DifficultySchema', () => {
  it('принимает все допустимые значения (1–5)', () => {
    for (let i = DIFFICULTY_MIN; i <= DIFFICULTY_MAX; i++) {
      expect(() => DifficultySchema.parse(i)).not.toThrow();
    }
  });

  it('отклоняет значения вне диапазона', () => {
    expect(() => DifficultySchema.parse(DIFFICULTY_MIN - 1)).toThrow();
    expect(() => DifficultySchema.parse(DIFFICULTY_MAX + 1)).toThrow();
  });

  it('отклоняет дробное число', () => {
    expect(() => DifficultySchema.parse(2.5)).toThrow();
  });

  it('отклоняет строку', () => {
    expect(() => DifficultySchema.parse('3')).toThrow();
  });
});

describe('TaskSchema', () => {
  const validTask = {
    id: UUID,
    title: 'Найти кнопку',
    prompt: 'Найдите кнопку и нажмите её',
    imageId: null,
    difficulty: 1,
    isPreset: true,
    isVisible: true,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('валидирует корректную задачу', () => {
    expect(() => TaskSchema.parse(validTask)).not.toThrow();
  });

  it('отклоняет не-UUID в id', () => {
    expect(() => TaskSchema.parse({ ...validTask, id: 'not-a-uuid' })).toThrow();
  });

  it('принимает длинный title без ограничения длины', () => {
    expect(() => TaskSchema.parse({ ...validTask, title: 'a'.repeat(10_000) })).not.toThrow();
  });

  it('отклоняет пустой title', () => {
    expect(() => TaskSchema.parse({ ...validTask, title: '' })).toThrow();
  });

  it('включает prompt в публичный контракт', () => {
    const result = TaskSchema.parse(validTask);
    expect(result.prompt).toBe('Найдите кнопку и нажмите её');
  });

  it('отклоняет пустой prompt', () => {
    expect(() => TaskSchema.parse({ ...validTask, prompt: '' })).toThrow();
  });
});

describe('CreateTaskSchema', () => {
  const validInput = {
    title: 'Найти товар', prompt: 'Найдите товар и откройте карточку', imageId: null, difficulty: 2,
  };

  it('валидирует корректный ввод', () => {
    expect(() => CreateTaskSchema.parse(validInput)).not.toThrow();
  });

  it('не принимает isPreset из публичного ввода', () => {
    const result = CreateTaskSchema.parse(validInput);
    expect(result).not.toHaveProperty('isPreset');
    expect(result).not.toHaveProperty('isVisible');
  });

  it('отклоняет пустой prompt', () => {
    expect(() => CreateTaskSchema.parse({ ...validInput, prompt: '' })).toThrow();
  });

  it('удаляет isPreset: true из публичного ввода', () => {
    const result = CreateTaskSchema.parse({ ...validInput, isPreset: true });
    expect(result).not.toHaveProperty('isPreset');
  });

  it('отклоняет пустой title', () => {
    expect(() => CreateTaskSchema.parse({ ...validInput, title: '' })).toThrow();
  });

  it('принимает длинный title без ограничения длины', () => {
    expect(() => CreateTaskSchema.parse({ ...validInput, title: 'x'.repeat(10_000) })).not.toThrow();
  });

  it('отклоняет difficulty вне диапазона', () => {
    expect(() => CreateTaskSchema.parse({ ...validInput, difficulty: 0 })).toThrow();
    expect(() => CreateTaskSchema.parse({ ...validInput, difficulty: 6 })).toThrow();
  });

  it('отклоняет отсутствие обязательных полей', () => {
    expect(() => CreateTaskSchema.parse({})).toThrow();
    expect(() => CreateTaskSchema.parse({ title: 'Test' })).toThrow();
  });
});

/* ================================================================== */
/* sessions                                                             */
/* ================================================================== */

describe('SessionModeSchema', () => {
  it.each(SESSION_MODES)('принимает "%s"', (mode) => {
    expect(() => SessionModeSchema.parse(mode)).not.toThrow();
  });

  it('отклоняет неизвестный режим', () => {
    expect(() => SessionModeSchema.parse('DUEL')).toThrow();
    expect(() => SessionModeSchema.parse('')).toThrow();
  });
});

describe('SessionStatusSchema', () => {
  it.each(Object.values(SESSION_STATUSES))('принимает "%s"', (status) => {
    expect(() => SessionStatusSchema.parse(status)).not.toThrow();
  });

  it('отклоняет неизвестный статус', () => {
    expect(() => SessionStatusSchema.parse('UNKNOWN')).toThrow();
    expect(() => SessionStatusSchema.parse('running')).toThrow(); // регистр
  });
});

describe('ParticipantSchema', () => {
  it.each(PARTICIPANTS)('принимает "%s"', (p) => {
    expect(() => ParticipantSchema.parse(p)).not.toThrow();
  });

  it('отклоняет неизвестного участника', () => {
    expect(() => ParticipantSchema.parse('BOT')).toThrow();
  });
});

describe('SessionMetricsSchema', () => {
  it('валидирует корректные метрики', () => {
    expect(() => SessionMetricsSchema.parse(VALID_METRICS)).not.toThrow();
  });

  it('отклоняет отрицательные числа', () => {
    expect(() => SessionMetricsSchema.parse({ ...VALID_METRICS, time: -1 })).toThrow();
    expect(() => SessionMetricsSchema.parse({ ...VALID_METRICS, steps: -1 })).toThrow();
    expect(() => SessionMetricsSchema.parse({ ...VALID_METRICS, errors: -1 })).toThrow();
  });

  it('принимает нулевые значения', () => {
    expect(() => SessionMetricsSchema.parse(VALID_METRICS)).not.toThrow();
  });

  it('отклоняет отсутствие participant', () => {
    expect(() => SessionMetricsSchema.parse({ time: 0, steps: 0, clicks: 0, errors: 0, retries: 0 })).toThrow();
  });
});

describe('SessionSchema', () => {
  const validSession = {
    id: UUID,
    taskId: UUID2,
    mode: 'SOLO',
    status: 'PENDING',
    difficulty: 2,
    connectArgs: null,
    vmName: null,
    guacId: null,
    agentTaskUuid: null,
    agentJobId: null,
    arenaOs: null,
    customImageId: null,
    agentLeftModel: null,
    sharingProfileId: null,
    metrics: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    guacAuthToken: null,
    guacTunnelId: null,
    historyMaxStepsCount: null,
    maxScreenshotsDelay: null,
    maxIterations: 25,
    modelRetries: 4,
    mouseClickDelay: 0.1,
    minOperationDelay: 2,
  };

  it('валидирует корректную сессию', () => {
    expect(() => SessionSchema.parse(validSession)).not.toThrow();
  });

  it('валидирует сессию с метриками', () => {
    expect(() => SessionSchema.parse({ ...validSession, metrics: [VALID_METRICS] })).not.toThrow();
  });

  it('отклоняет не-UUID в id и taskId', () => {
    expect(() => SessionSchema.parse({ ...validSession, id: 'bad' })).toThrow();
    expect(() => SessionSchema.parse({ ...validSession, taskId: 'bad' })).toThrow();
  });
});

describe('CreateSessionSchema', () => {
  const validSolo = {
    taskId: UUID,
    difficulty: 1,
    mode: 'SOLO' as const,
    arenaOs: 'ubuntu2204' as const,
    agentLeftModel: 'holo3' as const,
  };

  it('mode по умолчанию SOLO', () => {
    const result = CreateSessionSchema.parse({ ...validSolo, mode: undefined });
    expect(result.mode).toBe('SOLO');
  });

  it('принимает валидный SOLO с OS и моделью', () => {
    expect(() => CreateSessionSchema.parse(validSolo)).not.toThrow();
  });

  it('принимает валидные настройки config override для SOLO', () => {
    expect(() => CreateSessionSchema.parse({
      ...validSolo,
      maxIterations: 0,
      modelRetries: 0,
      mouseClickDelay: 0.1,
      minOperationDelay: 0,
    })).not.toThrow();
  });

  it('отклоняет отрицательные и дробные целочисленные настройки SOLO', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, maxIterations: -1 })).toThrow();
    expect(() => CreateSessionSchema.parse({ ...validSolo, modelRetries: 1.5 })).toThrow();
    expect(() => CreateSessionSchema.parse({ ...validSolo, mouseClickDelay: -0.1 })).toThrow();
    expect(() => CreateSessionSchema.parse({ ...validSolo, minOperationDelay: -1 })).toThrow();
  });

  it('отклоняет настройки config override для FULL_DUPLEX', () => {
    expect(() => CreateSessionSchema.parse({
      difficulty: 1,
      mode: 'FULL_DUPLEX',
      arenaOs: 'ubuntu2204',
      maxIterations: 25,
    })).toThrow();
  });

  it('отклоняет удалённый режим SPLIT', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, mode: 'SPLIT' })).toThrow();
  });

  it('отклоняет SOLO без arenaOs', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, arenaOs: undefined })).toThrow();
  });

  it('принимает SOLO без agentLeftModel: модель задаётся сервером', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, agentLeftModel: undefined })).not.toThrow();
  });

  it('принимает SOLO без arenaOs, если указан customImageId', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, arenaOs: undefined, customImageId: 'my-team-image-v3' })).not.toThrow();
  });

  it('отклоняет customImageId с недопустимыми символами', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, customImageId: 'bad image!' })).toThrow();
  });

  it('принимает FULL_DUPLEX без arenaOs, если указан customImageId', () => {
    expect(() => CreateSessionSchema.parse({ difficulty: 1, mode: 'FULL_DUPLEX' as const, customImageId: 'img-1' })).not.toThrow();
  });

  it('принимает FULL_DUPLEX без arenaOs и без customImageId', () => {
    expect(() => CreateSessionSchema.parse({ difficulty: 1, mode: 'FULL_DUPLEX' as const })).not.toThrow();
  });

  it('отклоняет невалидный UUID', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, taskId: 'not-a-uuid' })).toThrow();
  });

  it('отклоняет difficulty вне диапазона', () => {
    expect(() => CreateSessionSchema.parse({ ...validSolo, difficulty: 0 })).toThrow();
    expect(() => CreateSessionSchema.parse({ ...validSolo, difficulty: 6 })).toThrow();
  });

  it('отклоняет отсутствие обязательных полей', () => {
    expect(() => CreateSessionSchema.parse({})).toThrow();
    expect(() => CreateSessionSchema.parse({ taskId: UUID })).toThrow();
  });
});

describe('UpdateSessionSchema', () => {
  it('принимает только status', () => {
    expect(() => UpdateSessionSchema.parse({ status: 'RUNNING' })).not.toThrow();
  });

  it('принимает только metrics', () => {
    expect(() => UpdateSessionSchema.parse({ metrics: [VALID_METRICS] })).not.toThrow();
  });

  it('принимает пустой объект (ничего не меняем)', () => {
    expect(() => UpdateSessionSchema.parse({})).not.toThrow();
  });

  it('отклоняет невалидный status', () => {
    expect(() => UpdateSessionSchema.parse({ status: 'INVALID' })).toThrow();
  });
});

/* ================================================================== */
/* arena / websocket                                                    */
/* ================================================================== */

describe('WsEventSchema', () => {
  it('валидирует METRICS_UPDATE', () => {
    expect(() =>
      WsEventSchema.parse({ type: 'METRICS_UPDATE', payload: VALID_METRICS })
    ).not.toThrow();
  });

  it('валидирует STATUS_CHANGE', () => {
    expect(() =>
      WsEventSchema.parse({ type: 'STATUS_CHANGE', payload: { status: 'RUNNING' } })
    ).not.toThrow();
  });

  it('валидирует STATUS_CHANGE с connectArgs и сохраняет его в payload', () => {
    const result = WsEventSchema.parse({ type: 'STATUS_CHANGE', payload: { status: 'PREPARING', connectArgs: 'token=abc' } });
    expect(result).toMatchObject({ payload: { connectArgs: 'token=abc' } });
  });

  it('валидирует STEP_COMPLETE', () => {
    expect(() =>
      WsEventSchema.parse({ type: 'STEP_COMPLETE', payload: { stepIndex: 0, description: 'Старт' } })
    ).not.toThrow();
  });

  it('валидирует полный STEP-конверт как AGENT_THOUGHT', () => {
    expect(() => WsEventSchema.parse({
      type: 'AGENT_THOUGHT',
      payload: { step: 1, ts: 123, text: 'Открываю браузер', status: 'INCOMPLETE' },
    })).not.toThrow();
  });

  it('отклоняет неизвестный type', () => {
    expect(() => WsEventSchema.parse({ type: 'UNKNOWN', payload: {} })).toThrow();
  });

  it('отклоняет METRICS_UPDATE с отрицательными значениями', () => {
    expect(() =>
      WsEventSchema.parse({ type: 'METRICS_UPDATE', payload: { ...VALID_METRICS, time: -1 } })
    ).toThrow();
  });

  it('отклоняет STATUS_CHANGE с неизвестным статусом', () => {
    expect(() =>
      WsEventSchema.parse({ type: 'STATUS_CHANGE', payload: { status: 'BROKEN' } })
    ).toThrow();
  });

  it('отклоняет STEP_COMPLETE с отрицательным stepIndex', () => {
    expect(() =>
      WsEventSchema.parse({ type: 'STEP_COMPLETE', payload: { stepIndex: -1, description: 'x' } })
    ).toThrow();
  });

  it('отклоняет событие без поля type', () => {
    expect(() => WsEventSchema.parse({ payload: {} })).toThrow();
  });
});

describe('Full Duplex default environment', () => {
  it('разрешает минимальный demo запрос только для FD', () => {
    expect(CreateSessionSchema.parse({ mode: 'FULL_DUPLEX', difficulty: 1 })).toEqual({ mode: 'FULL_DUPLEX', difficulty: 1 });
    for (const mode of ['SOLO', 'HUMAN_VS_AGENT']) {
      expect(CreateSessionSchema.safeParse({ mode, taskId: UUID, difficulty: 1 }).success).toBe(false);
    }
  });
});
