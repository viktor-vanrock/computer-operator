import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(), updateMany: vi.fn(), claims: vi.fn(), acquisition: vi.fn(),
  findByName: vi.fn(), attempts: vi.fn(), retryTerminal: vi.fn(), recoverRaces: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
vi.mock('@/lib/config/env.js', () => ({ env: { DEFAULT_IMAGE_ID: 'image' } }));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: {
  session: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  activeVmClaim: { findMany: mocks.claims },
  vmAcquisitionAttempt: { findMany: mocks.attempts, findFirst: mocks.acquisition },
} }));
vi.mock('@/lib/vm-fleet/index.js', () => ({ vmFleetClient: { findByName: mocks.findByName } }));
vi.mock('@/lib/agent/agent-manager.client.js', () => ({ agentManager: {}, fullDuplexAgentManager: {} }));
vi.mock('@/lib/guacamole/index.js', () => ({ guacamoleClient: {} }));
vi.mock('@/lib/logger.js', () => ({ logger: { child: () => ({ info: vi.fn(), warn: mocks.warn, error: mocks.error }) } }));
vi.mock('@/lib/metrics/metrics.js', () => ({}));
vi.mock('@/modules/arena/arena.router.js', () => ({ broadcast: vi.fn() }));
vi.mock('@/modules/tasks/tasks.service.js', () => ({ tasksService: {} }));
vi.mock('@/lib/session-runtime-owner.js', () => ({ sessionRuntimeOwner: {} }));
vi.mock('@/modules/sessions/race/race-actions.service.js', () => ({ creationHash: vi.fn() }));
vi.mock('@/modules/sessions/race/race-state.repository.js', () => ({ raceStateRepository: {} }));
vi.mock('@/modules/sessions/race/race-coordinator.js', () => ({ raceCoordinator: {} }));
vi.mock('@/modules/sessions/race/race-recovery.js', () => ({ recoverRaces: mocks.recoverRaces }));
vi.mock('@/modules/sessions/vm-claims/vm-claims.service.js', () => ({ vmClaimsService: {} }));
vi.mock('@/modules/sessions/vm-claims/vm-cleanup.service.js', () => ({ vmCleanupService: { retryTerminal: mocks.retryTerminal } }));

import { sessionsService } from '@/modules/sessions/sessions.service.js';

const stale = { id: 'old-session', mode: 'SOLO', status: 'RUNNING', vmName: 'old-vm', updatedAt: new Date('2026-10-12') };

describe('legacy sessions runtime recovery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findMany.mockResolvedValue([stale]);
    mocks.claims.mockResolvedValue([]);
    mocks.acquisition.mockResolvedValue(null);
    mocks.attempts.mockResolvedValue([]);
    mocks.findByName.mockResolvedValue(null);
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it.each(['SOLO', 'FULL_DUPLEX'])('recovers %s after Fleet confirms the historical VM is absent', async mode => {
    mocks.findMany.mockResolvedValue([{ ...stale, mode }]);
    await expect(sessionsService.recoverRuntime()).resolves.toBeUndefined();
    expect(mocks.findByName).toHaveBeenCalledExactlyOnceWith('old-vm');
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: stale.id, status: stale.status, vmName: stale.vmName, updatedAt: stale.updatedAt },
      data: { status: 'FAILED' },
    });
    expect(mocks.retryTerminal).toHaveBeenCalledOnce();
    expect(mocks.recoverRaces).toHaveBeenCalledOnce();
  });

  it('preserves an existing unproven VM and reports the blocking identity', async () => {
    mocks.findByName.mockResolvedValue({ id: 'possibly-foreign', name: stale.vmName });
    await expect(sessionsService.recoverRuntime()).rejects.toThrow('LEGACY_VM_IDENTITY_UNKNOWN');
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: stale.id, vmName: stale.vmName, mode: stale.mode, candidateVmId: 'possibly-foreign',
    }), expect.any(String));
  });

  it('never treats a Fleet timeout as an absent VM or partially finalizes earlier rows', async () => {
    mocks.findMany.mockResolvedValue([stale, { ...stale, id: 'second', vmName: 'second-vm' }]);
    mocks.findByName.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('timeout'));
    await expect(sessionsService.recoverRuntime()).rejects.toThrow('LEGACY_VM_LOOKUP_FAILED');
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'second', vmName: 'second-vm' }), expect.any(String));
  });

  it('recovers already-confirmed cleanup without inspecting a reused name', async () => {
    mocks.acquisition.mockResolvedValue({ candidateVmId: 'deleted-id' });
    await sessionsService.recoverRuntime();
    expect(mocks.findByName).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalled();
  });

  it('keeps persisted claims on the normal durable cleanup path', async () => {
    mocks.claims.mockResolvedValue([{ vmName: stale.vmName, vmId: 'owned' }]);
    await sessionsService.recoverRuntime();
    expect(mocks.findByName).not.toHaveBeenCalled();
    expect(mocks.retryTerminal).toHaveBeenCalledOnce();
  });

  it('does not overwrite a concurrent session change while awaiting Fleet', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(sessionsService.recoverRuntime()).rejects.toThrow('SESSION_RECOVERY_STATE_CHANGED');
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: stale.updatedAt, status: 'RUNNING' }),
    }));
  });
});
