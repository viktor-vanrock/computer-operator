vi.mock('@/modules/sessions/vm-claims/vm-cleanup.service.js', () => ({ vmCleanupService: { cleanup: vi.fn().mockResolvedValue(true) } }));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/session-runtime-owner.js', () => ({ sessionRuntimeOwner: { requireReady: vi.fn() } }));

vi.mock('@/lib/config/env.js', () => ({
  env: {
    AGENT_MANAGER_API_URL: 'http://localhost:4000',
    AGENT_MANAGER_USERNAME: 'user',
    AGENT_MANAGER_PASSWORD: 'pass',
    VMFLEET_URL: 'http://vm-fleet',
    VMFLEET_TOKEN: 'test-token',
    DEFAULT_IMAGE_ID: '8b2a638d-cdac-479e-9152-5d00b3164707',
    FULL_DUPLEX_API_URL: 'http://full-duplex',
    FULL_DUPLEX_USERNAME: 'user',
    FULL_DUPLEX_PASSWORD: 'pass',
    PORT: 3001,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test',
    LOG_LEVEL: 'error',
    METRICS_TOKEN: undefined,
    GUACAMOLE_URL: 'http://guac',
    GUACAMOLE_ADMIN_USERNAME: 'admin',
    GUACAMOLE_ADMIN_PASSWORD: 'pass',
    GUAC_HEARTBEAT_INTERVAL_MS: 300000,
    KEYCLOAK_URL: 'http://keycloak',
    KEYCLOAK_REALM: 'test',
    KEYCLOAK_CLIENT_ID: 'test-client',
    KEYCLOAK_CLIENT_SECRET: 'test-secret',
    SESSION_SECRET: 'test-secret-test-secret-test-secret',
    FRONTEND_TECH_URL: 'http://localhost:5174',
    BACKEND_URL: 'http://localhost:3001',
  },
  isDev: false,
}));

import { DEFAULT_IMAGE_BY_OS, FULL_DUPLEX_DEFAULTS } from '@/modules/sessions/sessions.constants.js';
const mockPrismaSessionCreate = vi.fn();

vi.mock('@/lib/db/prisma.js', () => ({
  prisma: {
    session: { create: mockPrismaSessionCreate },
  },
}));

vi.mock('@/modules/tasks/tasks.service.js', () => ({
  tasksService: { findById: vi.fn().mockResolvedValue({ id: 'task-id', title: 'Test Task', prompt: 'Agent prompt' }) },
}));

vi.mock('@/modules/arena/arena.router.js', () => ({ broadcast: vi.fn() }));

vi.mock('@/lib/metrics/metrics.js', () => ({
  sessionsCreatedTotal: { inc: vi.fn() },
  sessionDurationSeconds: { observe: vi.fn() },
  agentStartDurationSeconds: { observe: vi.fn() },
  sessionsActive: { set: vi.fn() },
  sessionsCompletedTotal: { inc: vi.fn() },
  sessionsFailedTotal: { inc: vi.fn() },
  metricsService: { incrementCounter: vi.fn(), recordDuration: vi.fn() },
}));

vi.mock('@/lib/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock('@/lib/agent/agent-manager.client.js', () => ({
  agentManager: { testConnection: vi.fn().mockResolvedValue(true),
    listProfiles: vi.fn().mockResolvedValue([{ id: 'holo3', displayName: 'Holo3' }, { id: 'default', displayName: 'Computer Operator' }]),
  },
  fullDuplexAgentManager: { testConnection: vi.fn().mockResolvedValue(true) },
}));

vi.mock('@/lib/guacamole/index.js', () => ({
  guacamoleClient: { testConnection: vi.fn().mockResolvedValue(true) },
}));

vi.mock('@/lib/vm-fleet/index.js', () => ({
  vmFleetClient: { testConnection: vi.fn().mockResolvedValue(true) },
}));

const TASK_UUID = '550e8400-e29b-41d4-a716-446655440099';
const SESSION_UUID = '550e8400-e29b-41d4-a716-446655440000';

function mockCreateResolvedValue(overrides: Record<string, unknown> = {}) {
  mockPrismaSessionCreate.mockResolvedValue({
    id: SESSION_UUID,
    taskId: TASK_UUID,
    mode: 'SOLO',
    status: 'PENDING',
    difficulty: 1,
    connectArgs: null,
    guacAuthToken: null,
    guacTunnelId: null,
    vmName: null,
    guacId: null,
    agentTaskUuid: null,
    agentJobId: null,
    arenaOs: null,
    customImageId: null,
    historyMaxStepsCount: null,
    maxScreenshotsDelay: null,
    maxIterations: 25,
    modelRetries: 4,
    mouseClickDelay: 0.1,
    minOperationDelay: 2,
    agentLeftModel: 'holo3',
    sharingProfileId: null,
    metrics: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

describe('sessions.service create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('замораживает FD environment и backend defaults при минимальном запросе', async () => {
    mockCreateResolvedValue({ mode: 'FULL_DUPLEX' });
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({ mode: 'FULL_DUPLEX', difficulty: 1 });
    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      taskId: null, arenaOs: 'ubuntu2204', customImageId: null,
      resolvedImageId: '8b2a638d-cdac-479e-9152-5d00b3164707',
      historyMaxStepsCount: 20, maxScreenshotsDelay: 10, agentLeftModel: null,
    }) }));
  });

  it('new FD sessions resolve changed backend image/config defaults', async () => {
    mockCreateResolvedValue({ mode: 'FULL_DUPLEX' });
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    const previous = DEFAULT_IMAGE_BY_OS.ubuntu2204;
    DEFAULT_IMAGE_BY_OS.ubuntu2204 = 'changed-default';
    const config = { ...FULL_DUPLEX_DEFAULTS };
    Object.assign(FULL_DUPLEX_DEFAULTS, { HISTORY_MAX_STEPS_COUNT: 9, MAX_SCREENSHOTS_DELAY: 3 });
    try {
      await sessionsService.create({ mode: 'FULL_DUPLEX', difficulty: 1 });
      expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
        resolvedImageId: 'changed-default', historyMaxStepsCount: 9, maxScreenshotsDelay: 3,
      }) }));
    } finally { DEFAULT_IMAGE_BY_OS.ubuntu2204 = previous; Object.assign(FULL_DUPLEX_DEFAULTS, config); }
  });

  it('сохраняет explicit tech FD overrides', async () => {
    mockCreateResolvedValue({ mode: 'FULL_DUPLEX' });
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({ mode: 'FULL_DUPLEX', difficulty: 3, customImageId: 'tech-image', historyMaxStepsCount: 7, maxScreenshotsDelay: 4 });
    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      resolvedImageId: 'tech-image', historyMaxStepsCount: 7, maxScreenshotsDelay: 4,
    }) }));
  });

  it('передаёт customImageId в prisma.session.create при создании сессии с кастомным образом', async () => {
    mockCreateResolvedValue({ customImageId: 'my-team-image-v3', arenaOs: null });

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({
      taskId: TASK_UUID,
      mode: 'SOLO',
      difficulty: 1,
      customImageId: 'my-team-image-v3',
      agentLeftModel: 'holo3',
      historyMaxStepsCount: 100,
      maxScreenshotsDelay: 1000,
    });

    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ customImageId: 'my-team-image-v3' }),
    }));
  });

  it('пишет customImageId: null, если он не передан (существующее поведение arenaOs не ломается)', async () => {
    mockCreateResolvedValue({ arenaOs: 'ubuntu2204', customImageId: null });

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({
      taskId: TASK_UUID,
      mode: 'SOLO',
      difficulty: 1,
      arenaOs: 'ubuntu2204',
      agentLeftModel: 'holo3',
      historyMaxStepsCount: 100,
      maxScreenshotsDelay: 1000,
    });

    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ arenaOs: 'ubuntu2204', customImageId: null }),
    }));
  });

  it('сохраняет переданный config override для SOLO-сессии', async () => {
    mockCreateResolvedValue();

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({
      taskId: TASK_UUID,
      mode: 'SOLO',
      difficulty: 1,
      arenaOs: 'ubuntu2204',
      agentLeftModel: 'holo3',
      historyMaxStepsCount: 20,
      maxScreenshotsDelay: 10,
      maxIterations: 50,
      modelRetries: 7,
      mouseClickDelay: 0.25,
      minOperationDelay: 1.5,
    });

    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maxIterations: 50,
        modelRetries: 7,
        mouseClickDelay: 0.25,
        minOperationDelay: 1.5,
      }),
    }));
  });

  it('применяет дефолтный config override для SOLO-сессии', async () => {
    mockCreateResolvedValue();

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({
      taskId: TASK_UUID,
      mode: 'SOLO',
      difficulty: 1,
      arenaOs: 'ubuntu2204',
      agentLeftModel: 'holo3',
      historyMaxStepsCount: 20,
      maxScreenshotsDelay: 10,
    });

    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        maxIterations: 25,
        modelRetries: 4,
        mouseClickDelay: 0.1,
        minOperationDelay: 2,
      }),
    }));
  });

  it('сохраняет выбранную модель для SOLO-сессии', async () => {
    mockCreateResolvedValue({ agentLeftModel: 'holo3' });

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({
      taskId: TASK_UUID,
      mode: 'SOLO',
      difficulty: 1,
      arenaOs: 'ubuntu2204',
      agentLeftModel: 'holo3',
      historyMaxStepsCount: 20,
      maxScreenshotsDelay: 10,
    });

    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentLeftModel: 'holo3' }),
    }));
  });

  it('использует computer-operator для SOLO-сессии без явной модели', async () => {
    mockCreateResolvedValue({ agentLeftModel: 'computer-operator' });

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.create({
      taskId: TASK_UUID,
      mode: 'SOLO',
      difficulty: 1,
      arenaOs: 'ubuntu2204',
      historyMaxStepsCount: 20,
      maxScreenshotsDelay: 10,
    });

    expect(mockPrismaSessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agentLeftModel: 'computer-operator' }),
    }));
  });
});

describe('commands cannot bypass race coordinator', () => {
  afterEach(() => vi.restoreAllMocks());
  it('guards PATCH, next-task, stop-task and FD message on race', async () => {
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue({ mode: 'HUMAN_VS_AGENT' } as never);
    await expect(sessionsService.update(SESSION_UUID, { status: 'RUNNING' })).rejects.toMatchObject({ code: 'RACE_MANAGED_STATE' });
    for (const call of [() => sessionsService.startNextTask(SESSION_UUID, 'next'),
      () => sessionsService.stopTask(SESSION_UUID), () => sessionsService.sendFullDuplexMessage(SESSION_UUID, 'message')]) {
      await expect(call()).rejects.toMatchObject({ code: 'SESSION_MODE_MISMATCH' });
    }
  });
  it('rejects FD dispatch in wrong mode/status or with a missing handle', async () => {
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    const find = vi.spyOn(sessionsService, 'findById');
    for (const state of [{ mode: 'SOLO', status: 'RUNNING' }, { mode: 'FULL_DUPLEX', status: 'PREPARING' }, { mode: 'FULL_DUPLEX', status: 'COMPLETED' }]) {
      find.mockResolvedValue(state as never);
      await expect(sessionsService.sendFullDuplexMessage(SESSION_UUID, 'message')).rejects.toMatchObject({ code: 'SESSION_NOT_RUNNING' });
    }
    find.mockResolvedValue({ mode: 'FULL_DUPLEX', status: 'RUNNING' } as never);
    await expect(sessionsService.sendFullDuplexMessage(SESSION_UUID, 'message')).rejects.toMatchObject({ code: 'FULL_DUPLEX_CHANNEL_NOT_CONNECTED' });
  });
});
