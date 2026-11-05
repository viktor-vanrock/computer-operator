vi.mock('@/modules/sessions/vm-claims/vm-cleanup.service.js', () => ({ vmCleanupService: { cleanup: vi.fn().mockResolvedValue(true) } }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloSessionHandlers } from '@/lib/agent/agent-manager.types.js';

/**
 * Тесты для SOLO-режима sessions.service на новом WS-протоколе v1 агент-менеджера.
 * Мокируем agentManager.connectSession, чтобы захватить handlers, переданные сервисом,
 * и вручную дёргать их (onStep/onDiagnostics/onClosed), как это делал бы реальный сокет.
 */

vi.mock('@/lib/session-runtime-owner.js', () => ({ sessionRuntimeOwner: { requireReady: vi.fn(), isReady: () => true } }));

vi.mock('@/lib/config/env.js', () => ({
  env: {
    AGENT_MANAGER_API_URL: 'http://localhost:4000',
    VMFLEET_URL: 'http://vm-fleet',
    VMFLEET_TOKEN: 'test-token',
    DEFAULT_IMAGE_ID: '8b2a638d-cdac-479e-9152-5d00b3164707',
    PORT: 3001,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test',
    LOG_LEVEL: 'error',
    METRICS_TOKEN: undefined,
    GUACAMOLE_URL: 'http://guac',
    GUACAMOLE_ADMIN_USERNAME: 'admin',
    GUACAMOLE_ADMIN_PASSWORD: 'pass',
    GUAC_HEARTBEAT_INTERVAL_MS: 30 * 60 * 1000,
  },
  isDev: false,
}));

interface FakeSoloHandle {
  sendTask: ReturnType<typeof vi.fn>;
  cancelTask: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

let capturedHandlers: SoloSessionHandlers | undefined;
let lastHandle: FakeSoloHandle | undefined;

const mockConnectSession = vi.fn((
  _sessionId: string,
  _options: unknown,
  _initialTask: unknown,
  handlers: SoloSessionHandlers
): FakeSoloHandle => {
  capturedHandlers = handlers;
  lastHandle = { sendTask: vi.fn(), cancelTask: vi.fn(), close: vi.fn() };
  return lastHandle;
});

const mockDeleteVm = vi.fn().mockResolvedValue(undefined);
const mockGetVm = vi.fn();
const mockBroadcast = vi.fn();
const mockPrismaSessionUpdate = vi.fn();
const mockPrismaSessionUpdateMany = vi.fn();
const mockPrismaSessionFindUnique = vi.fn();
const mockStartHeartbeat = vi.fn();
const mockStopHeartbeat = vi.fn();

const mockGetAuthToken = vi.fn().mockResolvedValue('mock-auth-token');
const mockBuildConnectArgs = vi.fn().mockReturnValue('mock-connect-args');
const mockBuildSharingParams = vi.fn().mockResolvedValue({
  connectionId: 'mock-sharing-key',
  datasource: 'mysql-shared',
  guacToken: 'mock-guac-token',
  sharingProfileId: 'mock-profile-id',
  tunnelId: 'tunnel-1',
});

vi.mock('@/lib/agent/agent-manager.client.js', () => ({
  agentManager: {
    connectSession: mockConnectSession,
  },
  fullDuplexAgentManager: {},
}));

vi.mock('@/lib/vm-fleet/index.js', () => ({
  vmFleetClient: {
    reserveAvailable: mockGetVm,
    releaseReservation: vi.fn(),
    deleteVm: mockDeleteVm,
  },
}));

vi.mock('@/lib/guacamole/index.js', () => ({
  guacamoleClient: {
    getAuthToken: mockGetAuthToken,
    buildConnectArgs: mockBuildConnectArgs,
    buildSharingParams: mockBuildSharingParams,
    buildSharingParamsWithTunnel: mockBuildSharingParams,
    startHeartbeat: mockStartHeartbeat.mockReturnValue(mockStopHeartbeat),
  },
}));

vi.mock('@/modules/arena/arena.router.js', () => ({
  broadcast: mockBroadcast,
}));

vi.mock('@/lib/db/prisma.js', () => ({
  prisma: {
    session: {
      update: mockPrismaSessionUpdate,
      updateMany: mockPrismaSessionUpdateMany,
      findUnique: mockPrismaSessionFindUnique,
    },
    sessionMetrics: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/metrics/metrics.js', () => ({
  agentStartDurationSeconds: { observe: vi.fn() },
  metricsService: { recordSessionStart: vi.fn(), consumeSessionStart: vi.fn().mockReturnValue(42) },
  sessionDurationSeconds: { observe: vi.fn() },
  sessionsActive: { inc: vi.fn(), dec: vi.fn() },
  sessionsCompletedTotal: { inc: vi.fn() },
  sessionsCreatedTotal: { inc: vi.fn() },
  sessionsFailedTotal: { inc: vi.fn() },
}));

vi.mock('@/modules/tasks/tasks.service.js', () => ({
  tasksService: {
    findById: vi.fn().mockResolvedValue({ id: 'task-id', title: 'Блокнот', prompt: 'Открой блокнот' }),
  },
}));

vi.mock('@/lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

const UUID = '550e8400-e29b-41d4-a716-446655440001';
const TASK_UUID = '550e8400-e29b-41d4-a716-446655440002';

const baseSession = {
  id: UUID,
  taskId: TASK_UUID,
  mode: 'SOLO' as const,
  difficulty: 1,
  connectArgs: 'mock-connect-args',
  guacAuthToken: 'mock-auth-token',
  guacTunnelId: null,
  vmName: 'vm-test-1',
  guacId: 'guac-id-1',
  agentTaskUuid: null,
  agentJobId: null,
  arenaOs: 'ubuntu2204',
  customImageId: null,
  historyMaxStepsCount: null,
  maxScreenshotsDelay: null,
  maxIterations: 31,
  modelRetries: 6,
  mouseClickDelay: 0.25,
  minOperationDelay: 1.5,
  agentLeftModel: 'holo3',
  sharingProfileId: null,
  metrics: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const preparingSession = { ...baseSession, status: 'PREPARING' as const };
const runningSession = { ...baseSession, status: 'RUNNING' as const, agentTaskUuid: 'generated-task-id' };

describe('sessions.service SOLO v1', () => {
  beforeEach(() => {
    // sessions.service.ts хранит soloSessionHandles/soloRunningSessions на уровне модуля —
    // сбрасываем модульный кэш, чтобы состояние одного теста не утекало в следующий.
    vi.resetModules();
    vi.clearAllMocks();
    capturedHandlers = undefined;
    lastHandle = undefined;
    mockPrismaSessionFindUnique.mockResolvedValue(null);
    mockPrismaSessionUpdateMany.mockResolvedValue({ count: 1 });
    mockPrismaSessionUpdate.mockResolvedValue({ ...baseSession, status: 'RUNNING' });
    mockStartHeartbeat.mockReturnValue(mockStopHeartbeat);
    mockGetVm.mockResolvedValue({ vmName: 'vm-test-1', status: 'ready', connectionId: 'guac-id-1' });
  });

  async function completeStart(): Promise<void> {
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(preparingSession);
    vi.spyOn(sessionsService, 'setStatus').mockResolvedValue(runningSession);
    await sessionsService.completeAgentStart(UUID);
    mockPrismaSessionUpdateMany.mockClear();
  }

  it('открывает SOLO v1 WS с sharing-параметрами и переводит сессию в RUNNING', async () => {
    await completeStart();

    expect(mockConnectSession).toHaveBeenCalledTimes(1);
    const [sessionIdArg, optionsArg, initialTaskArg] = mockConnectSession.mock.calls[0]!;
    expect(sessionIdArg).toBe(UUID);
    expect(optionsArg).toEqual({
      profile: 'default',
      vmName: 'vm-test-1',
      connectionId: 'mock-sharing-key',
      datasource: 'mysql-shared',
      guacToken: 'mock-guac-token',
      configOverride: {
        maxIterations: 31,
        modelRetries: 6,
        mouseClickDelay: 0.25,
        minOperationDelay: 1.5,
      },
    });
    expect(initialTaskArg).toEqual(expect.objectContaining({ text: 'Открой блокнот' }));

    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledTimes(0);
    // Start writes are guarded by PREPARING; completeStart clears them for callback assertions.
    expect(mockStartHeartbeat).toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledWith(UUID, { type: 'STATUS_CHANGE', payload: { status: 'RUNNING' } });
  });

  it('STEP со статусом INCOMPLETE транслируется только как AGENT_THOUGHT', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onStep({ step: 1, ts: 1, text: 'Открываю меню', status: 'INCOMPLETE' });

    expect(mockBroadcast).toHaveBeenCalledTimes(1);
    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_THOUGHT',
      payload: { step: 1, ts: 1, text: 'Открываю меню', status: 'INCOMPLETE' },
    });
  });

  it('транслирует диагностические поля STEP во фронтенд-событие', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onStep({
      step: 19,
      ts: 1788514020719,
      text: 'Перехожу на ozon.ru',
      status: 'INCOMPLETE',
      thought: 'Мне нужно перейти на ozon.ru',
      action_explanation: 'Нажимаю на адресную строку',
      action_type: 'click',
      action_inputs: { point: [291, 115] },
    });

    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_THOUGHT',
      payload: expect.objectContaining({
        action_type: 'click',
        action_inputs: { point: [291, 115] },
        action_explanation: 'Нажимаю на адресную строку',
      }),
    });
  });

  it('STEP со статусом DONE дополнительно транслирует AGENT_OUTCOME finished/positive', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onStep({ step: 5, ts: 100, text: 'Готово', status: 'DONE' });

    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_THOUGHT',
      payload: { step: 5, ts: 100, text: 'Готово', status: 'DONE' },
    });
    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_OUTCOME',
      payload: { step: 5, ts: 100, kind: 'finished', value: 'positive' },
    });
  });

  it('STEP со статусом FAILED транслирует AGENT_OUTCOME finished/negative и не трогает статус сессии', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onStep({ step: 3, ts: 50, text: 'Не получилось', status: 'FAILED' });

    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_OUTCOME',
      payload: { step: 3, ts: 50, kind: 'finished', value: 'negative' },
    });
    expect(mockPrismaSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('STEP со статусом CANCELLED транслирует AGENT_OUTCOME aborted/user', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onStep({ step: 2, ts: 20, text: 'Отменено', status: 'CANCELLED' });

    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_OUTCOME',
      payload: { step: 2, ts: 20, kind: 'aborted', value: 'user' },
    });
  });

  it('DIAGNOSTICS с level=FATAL транслирует AGENT_ERROR', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onDiagnostics({ ts: 999, level: 'FATAL', event: 'guacamole_disconnected', raw: '{}' });

    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_ERROR',
      payload: expect.objectContaining({ code: 'guacamole_disconnected', fatal: true }),
    });
  });

  it('DIAGNOSTICS с level=CRITICAL транслирует AGENT_ERROR', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onDiagnostics({ ts: 999, level: 'CRITICAL', event: 'session_timeout', raw: '{}' });

    expect(mockBroadcast).toHaveBeenCalledWith(UUID, {
      type: 'AGENT_ERROR',
      payload: expect.objectContaining({ code: 'session_timeout', fatal: true }),
    });
  });

  it('DIAGNOSTICS с level=ERROR не транслирует AGENT_ERROR', async () => {
    await completeStart();
    mockBroadcast.mockClear();

    capturedHandlers!.onDiagnostics({ ts: 999, level: 'ERROR', event: 'unknown_property', raw: '{}' });

    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('onClosed(critical_diagnostics) переводит сессию в FAILED', async () => {
    await completeStart();
    vi.spyOn((await import('@/modules/sessions/sessions.service.js')).sessionsService, 'findById')
      .mockResolvedValue(runningSession);
    mockBroadcast.mockClear();

    capturedHandlers!.onClosed('critical_diagnostics');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(UUID, { type: 'STATUS_CHANGE', payload: { status: 'FAILED' } });
  });

  it('onClosed(client_request) переводит сессию в COMPLETED', async () => {
    await completeStart();
    vi.spyOn((await import('@/modules/sessions/sessions.service.js')).sessionsService, 'findById')
      .mockResolvedValue(runningSession);
    mockBroadcast.mockClear();

    capturedHandlers!.onClosed('client_request');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETED' }),
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(UUID, { type: 'STATUS_CHANGE', payload: { status: 'COMPLETED' } });
  });

  it('failGuacamoleConnection завершает RUNNING-сессию как FAILED, а не COMPLETED', async () => {
    await completeStart();
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(runningSession);
    mockBroadcast.mockClear();

    await sessionsService.failGuacamoleConnection(UUID);

    expect(lastHandle!.close).toHaveBeenCalledWith('guacamole_error');
    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(UUID, { type: 'STATUS_CHANGE', payload: { status: 'FAILED' } });
  });

  it('onClosed(ws_gone) переводит сессию в FAILED', async () => {
    await completeStart();
    vi.spyOn((await import('@/modules/sessions/sessions.service.js')).sessionsService, 'findById')
      .mockResolvedValue(runningSession);
    mockBroadcast.mockClear();

    capturedHandlers!.onClosed('ws_gone');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(mockBroadcast).toHaveBeenCalledWith(UUID, { type: 'STATUS_CHANGE', payload: { status: 'FAILED' } });
  });

  it('повторная финализация уже FAILED-сессии не удаляет VM повторно', async () => {
    await completeStart();
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue({ ...runningSession, status: 'FAILED' });
    mockDeleteVm.mockClear();

    capturedHandlers!.onClosed('ws_gone');
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockDeleteVm).not.toHaveBeenCalled();
    expect(mockPrismaSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('startNextTask шлёт TASK через существующий канал и сохраняет taskId', async () => {
    await completeStart();
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(runningSession);

    await sessionsService.startNextTask(UUID, 'Новая задача');

    const taskId = lastHandle!.sendTask.mock.calls[0]?.[1];
    expect(taskId).toEqual(expect.any(String));
    expect(mockPrismaSessionUpdate).toHaveBeenCalledWith({ where: { id: UUID }, data: { agentTaskUuid: taskId } });
  });

  it('startNextTask бросает ошибку, если SOLO-канал не подключён', async () => {
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(runningSession);

    await expect(sessionsService.startNextTask(UUID, 'text')).rejects.toThrow('SOLO session channel is not connected');
  });

  it('stopTask шлёт CANCEL_TASK и не завершает сессию', async () => {
    await completeStart();
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(runningSession);

    await sessionsService.stopTask(UUID);

    expect(lastHandle!.cancelTask).toHaveBeenCalledTimes(1);
    expect(mockPrismaSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('stopAgent с открытым каналом вызывает handle.close()', async () => {
    await completeStart();
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(runningSession);

    await sessionsService.stopAgent(UUID);

    expect(lastHandle!.close).toHaveBeenCalledTimes(1);
    // Финализация произойдёт асинхронно через onClosed — до этого статус не меняется здесь.
    expect(mockPrismaSessionUpdateMany).not.toHaveBeenCalled();
  });

  it('stopAgent без открытого канала и без предыдущего RUNNING финализирует сессию как FAILED', async () => {
    // Канал не был открыт (completeAgentStart не вызывался) — сессия никогда не
    // была реально RUNNING с точки зрения soloRunningSessions, поэтому client_request
    // всё равно приводит к FAILED, а не к COMPLETED (симметрично Full Duplex).
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(runningSession);

    await sessionsService.stopAgent(UUID);

    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED' }),
    }));
  });
});
