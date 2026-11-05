import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_IMAGE_BY_OS } from '@/modules/sessions/sessions.constants.js';

vi.mock('@/lib/session-runtime-owner.js', () => ({ sessionRuntimeOwner: { requireReady: vi.fn() } }));

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
  },
  isDev: false,
}));

const mockReserveAvailable = vi.fn();
const mockCleanup = vi.fn().mockResolvedValue(true);
vi.mock('@/modules/sessions/vm-claims/vm-claims.service.js', () => ({ vmClaimsService: { acquire: mockReserveAvailable } }));
vi.mock('@/modules/sessions/vm-claims/vm-cleanup.service.js', () => ({ vmCleanupService: { cleanup: mockCleanup } }));
const mockReleaseReservation = vi.fn();
const mockDeleteVm = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/vm-fleet/index.js', () => ({
  vmFleetClient: {
    reserveAvailable: mockReserveAvailable,
    releaseReservation: mockReleaseReservation,
    deleteVm: mockDeleteVm,
  },
}));

const mockGetAuthToken = vi.fn().mockResolvedValue('mock-auth-token');
const mockBuildConnectArgs = vi.fn().mockReturnValue('mock-connect-args');

vi.mock('@/lib/guacamole/index.js', () => ({
  guacamoleClient: {
    getAuthToken: mockGetAuthToken,
    buildConnectArgs: mockBuildConnectArgs,
  },
}));

const mockOpenTask = vi.fn();
const mockCloseTask = vi.fn();
const mockConnectThoughtStream = vi.fn();

vi.mock('@/lib/agent/agent-manager.client.js', () => ({
  agentManager: { openTask: mockOpenTask, closeTask: mockCloseTask, connectThoughtStream: mockConnectThoughtStream },
  fullDuplexAgentManager: { connectFullDuplex: vi.fn() },
}));

const mockBroadcast = vi.fn();
vi.mock('@/modules/arena/arena.router.js', () => ({ broadcast: mockBroadcast }));

const mockPrismaSessionUpdate = vi.fn();
const mockPrismaSessionUpdateMany = vi.fn();
const mockPrismaSessionFindUnique = vi.fn();
const mockPrismaSessionFindFirst = vi.fn().mockResolvedValue(null);
const mockPrismaQueryRaw = vi.fn();

vi.mock('@/lib/db/prisma.js', () => ({
  prisma: {
    session: {
      update: mockPrismaSessionUpdate,
      updateMany: mockPrismaSessionUpdateMany,
      findUnique: mockPrismaSessionFindUnique,
      findFirst: mockPrismaSessionFindFirst,
    },
    $queryRaw: mockPrismaQueryRaw,
  },
}));

vi.mock('@/modules/tasks/tasks.service.js', () => ({
  tasksService: { findById: vi.fn().mockResolvedValue({ id: 'task-id', title: 'Test Task', prompt: 'Agent prompt' }) },
}));

vi.mock('@/lib/metrics/metrics.js', () => ({
  agentStartDurationSeconds: { observe: vi.fn() },
  metricsService: { recordSessionStart: vi.fn(), consumeSessionStart: vi.fn() },
  sessionDurationSeconds: { observe: vi.fn() },
  sessionsActive: { inc: vi.fn(), dec: vi.fn() },
  sessionsCompletedTotal: { inc: vi.fn() },
  sessionsCreatedTotal: { inc: vi.fn() },
  sessionsFailedTotal: { inc: vi.fn() },
}));

vi.mock('@/lib/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

const UUID = '550e8400-e29b-41d4-a716-446655440010';

const baseSession = {
  id: UUID,
  taskId: '11111111-1111-4111-8111-111111111111',
  mode: 'SOLO' as const,
  status: 'PENDING' as const,
  difficulty: 1,
  connectArgs: null,
  guacAuthToken: null,
  guacTunnelId: null,
  vmName: null,
  guacId: null,
  agentTaskUuid: null,
  agentJobId: null,
  arenaOs: 'ubuntu2204',
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('sessions.service SOLO startAgent — Preset OS (VM Reservation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaSessionUpdate.mockResolvedValue({
      ...baseSession,
      status: 'PREPARING',
      connectArgs: 'mock-connect-args',
      vmName: 'reserved_vm_ubuntu2204_abc',
      guacId: 'guac-1',
      metrics: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrismaSessionUpdateMany.mockResolvedValue({ count: 1 });
    mockPrismaQueryRaw.mockResolvedValue([{ claimed: true }]);
    mockPrismaSessionFindFirst.mockResolvedValue(null);
  });

  it('резервирует VM синхронно и возвращает сессию уже в PREPARING с connectArgs', async () => {
    mockReserveAvailable.mockResolvedValue({ vmName: 'reserved_vm_ubuntu2204_abc', status: 'ready', connectionId: 'guac-1' });

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById')
      .mockResolvedValueOnce(baseSession)
      .mockResolvedValue({ ...baseSession, status: 'PREPARING', connectArgs: 'mock-connect-args', vmName: 'reserved_vm_ubuntu2204_abc', guacId: 'guac-1' });

    const result = await sessionsService.startAgent(UUID);

    expect(mockReserveAvailable).toHaveBeenCalledWith(UUID, 'AGENT', DEFAULT_IMAGE_BY_OS.ubuntu2204);
    expect(result.status).toBe('PREPARING');
    expect(result.connectArgs).toBe('mock-connect-args');

    const preparingBroadcast = mockBroadcast.mock.calls.find(
      (c) => (c[1] as { payload?: { status?: string } }).payload?.status === 'PREPARING'
    );
    expect(preparingBroadcast?.[1]).toMatchObject({ payload: { connectArgs: 'mock-connect-args' } });
  });

  it('при отсутствии свободной VM статус становится FAILED с reason VM_RESERVATION_EXHAUSTED', async () => {
    mockReserveAvailable.mockRejectedValue(new Error('No available VM for OS ubuntu2204'));
    const { sessionsFailedTotal } = await import('@/lib/metrics/metrics.js');

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(baseSession);
    vi.spyOn(sessionsService, 'setStatus').mockResolvedValue({ ...baseSession, status: 'FAILED' });

    await expect(sessionsService.startAgent(UUID)).rejects.toThrow();
    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED' } }));
    expect(sessionsFailedTotal.inc).toHaveBeenCalledWith({ reason: 'VM_RESERVATION_EXHAUSTED' });
  });

  it('не пытается приобрести следующую VM при неопределённом assignment/ownership conflict', async () => {
    mockReserveAvailable.mockRejectedValueOnce(new Error('VM_OWNERSHIP_CONFLICT'));
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(baseSession);
    await expect(sessionsService.startAgent(UUID)).rejects.toMatchObject({ code: 'VM_RESERVATION_EXHAUSTED' });
    expect(mockReserveAvailable).toHaveBeenCalledOnce();
    expect(mockDeleteVm).not.toHaveBeenCalled();
    expect(mockGetAuthToken).not.toHaveBeenCalled();
  });

  it('компенсирует поздний assignment после stop, не запуская Guacamole', async () => {
    mockPrismaSessionUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mockReserveAvailable.mockResolvedValue({ vmId: 'id', vmName: 'late-vm', connectionId: 'guac-1' });
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(baseSession);
    await sessionsService.startAgent(UUID);
    expect(mockCleanup).toHaveBeenCalledWith(UUID, true);
    expect(mockGetAuthToken).not.toHaveBeenCalled();
  });

  it('устаревший/незамапленный arenaOs (нет в DEFAULT_IMAGE_BY_OS) переводит сессию в FAILED, а не оставляет висеть в PENDING', async () => {
    const legacyOsSession = { ...baseSession, arenaOs: 'legacy-windows' };
    const { sessionsFailedTotal } = await import('@/lib/metrics/metrics.js');

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(legacyOsSession);
    const setStatusSpy = vi.spyOn(sessionsService, 'setStatus').mockResolvedValue({ ...legacyOsSession, status: 'FAILED' });

    await expect(sessionsService.startAgent(UUID)).rejects.toMatchObject({ code: 'ARENA_OS_UNMAPPED' });

    expect(mockReserveAvailable).not.toHaveBeenCalled();
    expect(setStatusSpy).toHaveBeenCalledWith(UUID, 'FAILED');
    expect(sessionsFailedTotal.inc).toHaveBeenCalledWith({ reason: 'ARENA_OS_UNMAPPED' });
    const failedBroadcast = mockBroadcast.mock.calls.find(
      (c) => (c[1] as { payload?: { status?: string } }).payload?.status === 'FAILED'
    );
    expect(failedBroadcast).toBeDefined();
  });
});

describe('sessions.service SOLO startAgent — Custom OS Image (VM Reservation from pool, sync)', () => {
  const customImageSession = { ...baseSession, arenaOs: null, customImageId: 'my-team-image-v3' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaSessionUpdate.mockResolvedValue({
      ...baseSession,
      status: 'PREPARING',
      connectArgs: 'mock-connect-args',
      vmName: 'reserved_vm_my-team-image-v3_abc',
      guacId: 'guac-custom-1',
      customImageId: 'my-team-image-v3',
      arenaOs: null,
      metrics: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    mockPrismaSessionUpdateMany.mockResolvedValue({ count: 1 });
    mockPrismaQueryRaw.mockResolvedValue([{ claimed: true }]);
  });

  it('резервирует VM из пула по customImageId синхронно, без deployment API', async () => {
    mockReserveAvailable.mockResolvedValue({ vmName: 'reserved_vm_my-team-image-v3_abc', status: 'ready', connectionId: 'guac-custom-1' });

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById')
      .mockResolvedValueOnce(customImageSession)
      .mockResolvedValue({ ...customImageSession, status: 'PREPARING', connectArgs: 'mock-connect-args', vmName: 'reserved_vm_my-team-image-v3_abc', guacId: 'guac-custom-1' });

    const result = await sessionsService.startAgent(UUID);

    expect(mockReserveAvailable).toHaveBeenCalledWith(UUID, 'AGENT', 'my-team-image-v3');
    expect(result.status).toBe('PREPARING');
    expect(result.connectArgs).toBe('mock-connect-args');
  });

  it('при отсутствии свободной VM с нужным customImageId статус становится FAILED с reason VM_RESERVATION_EXHAUSTED', async () => {
    mockReserveAvailable.mockRejectedValue(new Error('No available VM for image my-team-image-v3'));
    const { sessionsFailedTotal } = await import('@/lib/metrics/metrics.js');

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    vi.spyOn(sessionsService, 'findById').mockResolvedValue(customImageSession);
    vi.spyOn(sessionsService, 'setStatus').mockResolvedValue({ ...customImageSession, status: 'FAILED' });

    await expect(sessionsService.startAgent(UUID)).rejects.toThrow();
    expect(mockPrismaSessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FAILED' } }));
    expect(sessionsFailedTotal.inc).toHaveBeenCalledWith({ reason: 'VM_RESERVATION_EXHAUSTED' });
  });
});
