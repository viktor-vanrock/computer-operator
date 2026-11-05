import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  deleteVm: vi.fn(),
  findByName: vi.fn(),
  cleanup: vi.fn().mockResolvedValue(true),
  readRace: vi.fn(), createRace: vi.fn(), finishRace: vi.fn(), cleanupRace: vi.fn(),
}));

vi.mock('@/modules/sessions/race/race-state.repository.js', () => ({ raceStateRepository: { read: mocks.readRace, create: mocks.createRace } }));
vi.mock('@/modules/sessions/race/race-coordinator.js', () => ({ raceCoordinator: { finish: mocks.finishRace, cleanup: mocks.cleanupRace } }));
vi.mock('@/lib/session-runtime-owner.js', () => ({ sessionRuntimeOwner: { requireReady: vi.fn() } }));

vi.mock('@/modules/sessions/vm-claims/vm-cleanup.service.js', () => ({ vmCleanupService: { cleanup: mocks.cleanup } }));

vi.mock('@/lib/config/env.js', () => ({ env: { NODE_ENV: 'test' }, isDev: false }));
vi.mock('@/lib/db/prisma.js', () => ({
  prisma: { session: { findUnique: mocks.findUnique, create: mocks.create, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/vm-fleet/index.js', () => ({
  vmFleetClient: {
    findByName: mocks.findByName,
    deleteVm: mocks.deleteVm,
    reserveAvailable: vi.fn(),
    releaseReservation: vi.fn(),
  },
}));
vi.mock('@/lib/agent/agent-manager.client.js', () => ({
  agentManager: {}, fullDuplexAgentManager: {},
}));
vi.mock('@/lib/guacamole/index.js', () => ({ guacamoleClient: {} }));
vi.mock('@/modules/arena/arena.router.js', () => ({ broadcast: vi.fn() }));
vi.mock('@/modules/tasks/tasks.service.js', () => ({ tasksService: {} }));
vi.mock('@/lib/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
vi.mock('@/lib/metrics/metrics.js', () => ({
  agentStartDurationSeconds: { observe: vi.fn() },
  metricsService: { consumeSessionStart: vi.fn() },
  sessionDurationSeconds: { observe: vi.fn() },
  sessionsActive: { inc: vi.fn(), dec: vi.fn() },
  sessionsCompletedTotal: { inc: vi.fn() },
  sessionsCreatedTotal: { inc: vi.fn() },
  sessionsFailedTotal: { inc: vi.fn() },
}));

const now = new Date('2026-09-11T00:00:00Z');
const source = {
  id: '11111111-1111-4111-8111-111111111111', taskId: '22222222-2222-4222-8222-222222222222',
  mode: 'SOLO', status: 'FAILED', difficulty: 3, connectArgs: 'secret', guacAuthToken: 'secret',
  guacTunnelId: 'tunnel', vmName: 'vm-1', guacId: 'guac', agentTaskUuid: 'task', agentJobId: null,
  arenaOs: 'ubuntu2204', customImageId: null, historyMaxStepsCount: null, maxScreenshotsDelay: null,
  maxIterations: 25, modelRetries: 4, mouseClickDelay: 0.1, minOperationDelay: 2,
  agentLeftModel: 'computer-operator', sharingProfileId: 'share', restartedFromSessionId: null,
  metrics: [], createdAt: now, updatedAt: now,
};

describe('sessionsService.restart', () => {
  it('restarts FD with the saved image instead of current defaults', async () => {
    const fd = { ...source, mode: 'FULL_DUPLEX', taskId: null, resolvedImageId: 'saved-image' };
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(fd);
    mocks.create.mockResolvedValue({ ...fd, id: '33333333-3333-4333-8333-333333333333', status: 'PENDING' });
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    await sessionsService.restart(fd.id);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resolvedImageId: 'saved-image', mode: 'FULL_DUPLEX' }) }));
  });
  beforeEach(() => vi.clearAllMocks());

  it('очищает VM и создаёт чистую replacement-сессию с прежней конфигурацией', async () => {
    const replacement = {
      ...source, id: '33333333-3333-4333-8333-333333333333', status: 'PENDING',
      connectArgs: null, guacAuthToken: null, guacTunnelId: null, vmName: null, guacId: null,
      agentTaskUuid: null, sharingProfileId: null, restartedFromSessionId: source.id,
    };
    mocks.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(source);
    mocks.findByName.mockResolvedValue({ id: 'vm-id', name: 'vm-1' });
    mocks.deleteVm.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue(replacement);

    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    const result = await sessionsService.restart(source.id);

    expect(mocks.cleanup).toHaveBeenCalledWith(source.id, true);
    expect(mocks.deleteVm).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        taskId: source.taskId,
        maxIterations: 25,
        restartedFromSessionId: source.id,
      }),
    }));
    expect(result.status).toBe('PENDING');
    expect(result.connectArgs).toBeNull();
  });

  it('возвращает ранее созданную replacement-сессию', async () => {
    const replacement = { ...source, id: '33333333-3333-4333-8333-333333333333', restartedFromSessionId: source.id };
    mocks.findUnique.mockResolvedValue(replacement);
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    const result = await sessionsService.restart(source.id);
    expect(result.id).toBe(replacement.id);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe('race restart cleanup gate', () => {
  afterEach(() => vi.restoreAllMocks());
  it('does not create a replacement or alter the winner while cleanup is incomplete', async () => {
    const { sessionsService } = await import('@/modules/sessions/sessions.service.js');
    mocks.findUnique.mockResolvedValue(null);
    vi.spyOn(sessionsService, 'findById').mockResolvedValue({ ...source, mode: 'HUMAN_VS_AGENT' } as never);
    const race = { cleanupStatus: 'FAILED', winner: 'HUMAN', taskTitle: 'Task', taskPrompt: 'Prompt', resolvedImageId: 'image' };
    mocks.readRace.mockResolvedValue({ race });
    await expect(sessionsService.restart(source.id)).rejects.toMatchObject({ statusCode: 409, code: 'CLEANUP_PENDING' });
    expect(mocks.createRace).not.toHaveBeenCalled(); expect(race.winner).toBe('HUMAN');
  });
});
