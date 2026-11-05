import { beforeEach, describe, expect, it, vi } from 'vitest';
import { vmCleanupService } from '@/modules/sessions/vm-claims/vm-cleanup.service.js';

const mocks = vi.hoisted(() => ({
  db: {
    session: { findUnique: vi.fn() },
    activeVmClaim: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    vmAcquisitionAttempt: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  },
  fleet: { deleteVmById: vi.fn(), releaseReservation: vi.fn(), findByName: vi.fn() },
  claims: { resolveAttempt: vi.fn(), hasPending: vi.fn() },
}));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('@/lib/vm-fleet/index.js', () => ({ vmFleetClient: mocks.fleet }));
vi.mock('@/modules/sessions/vm-claims/vm-claims.service.js', () => ({
  vmClaimsService: mocks.claims, unresolvedAcquisitionStatuses: ['PENDING', 'ASSIGNED', 'COMPENSATING'],
}));

const claim = {
  sessionId: 'session', participant: 'AGENT', vmName: 'reused-name', vmId: 'old-id',
  cleanupAttempts: 0, nextRetryAt: null,
};

describe('durable VM cleanup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claims.hasPending.mockReturnValue(false);
    mocks.db.session.findUnique.mockResolvedValue(null);
    mocks.db.vmAcquisitionAttempt.findFirst.mockResolvedValue(null);
    mocks.db.vmAcquisitionAttempt.findMany.mockResolvedValue([]);
    mocks.db.activeVmClaim.findMany.mockResolvedValue([claim]);
    mocks.db.activeVmClaim.updateMany.mockResolvedValue({ count: 1 });
    mocks.db.activeVmClaim.count.mockResolvedValue(0);
    mocks.db.vmAcquisitionAttempt.count.mockResolvedValue(0);
  });

  it('deletes persisted id, never a new VM reusing its name; releases claim only after waitDeleted', async () => {
    let deleted!: () => void;
    mocks.fleet.deleteVmById.mockReturnValue(new Promise<void>((resolve) => { deleted = resolve; }));
    const cleaning = vmCleanupService.cleanup('session', true);
    await vi.waitFor(() => expect(mocks.fleet.deleteVmById).toHaveBeenCalledWith('old-id'));
    expect(mocks.db.activeVmClaim.deleteMany).not.toHaveBeenCalled();
    deleted();
    await expect(cleaning).resolves.toBe(true);
    expect(mocks.db.activeVmClaim.deleteMany).toHaveBeenCalledWith({ where: {
      sessionId: 'session', vmName: 'reused-name', vmId: 'old-id',
    } });
  });

  it('retains failed claim with durable backoff and still deletes the other participant', async () => {
    mocks.db.activeVmClaim.findMany.mockResolvedValue([claim, { ...claim, participant: 'HUMAN', vmName: 'human', vmId: 'human-id' }]);
    mocks.fleet.deleteVmById.mockImplementation(async (id) => {
      if (id === 'old-id') throw new Error('delete timeout');
    });
    mocks.db.activeVmClaim.count.mockResolvedValue(1);
    await expect(vmCleanupService.cleanup('session', true)).resolves.toBe(false);
    expect(mocks.fleet.deleteVmById).toHaveBeenCalledWith('human-id');
    expect(mocks.db.activeVmClaim.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ cleanupStatus: 'FAILED', nextRetryAt: expect.any(Date) }),
    }));
    expect(mocks.db.activeVmClaim.deleteMany).not.toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vmId: 'old-id' }),
    }));
  });

  it('does not report COMPLETE for an unresolved acquisition without a claim', async () => {
    mocks.db.vmAcquisitionAttempt.findMany.mockResolvedValue([{ id: 'pending' }]);
    mocks.claims.resolveAttempt.mockRejectedValue(new Error('ambiguous assignment'));
    mocks.db.activeVmClaim.findMany.mockResolvedValue([]);
    mocks.db.vmAcquisitionAttempt.count.mockResolvedValue(1);
    await expect(vmCleanupService.cleanup('session', true)).resolves.toBe(false);
    expect(mocks.fleet.deleteVmById).not.toHaveBeenCalled();
  });

  it('recovers crash intent before enumerating claims and only selects claims of this owner', async () => {
    mocks.db.vmAcquisitionAttempt.findMany.mockResolvedValue([{ id: 'pending' }]);
    await expect(vmCleanupService.cleanup('session', true)).resolves.toBe(true);
    expect(mocks.claims.resolveAttempt).toHaveBeenCalledWith({ id: 'pending' });
    expect(mocks.db.activeVmClaim.findMany).toHaveBeenCalledWith({ where: { sessionId: 'session' } });
  });

  it('does not race a still-running assign request with recovery', async () => {
    mocks.claims.hasPending.mockReturnValue(true);
    mocks.db.vmAcquisitionAttempt.findMany.mockResolvedValue([{ id: 'pending' }]);
    mocks.db.activeVmClaim.findMany.mockResolvedValue([]);
    mocks.db.vmAcquisitionAttempt.count.mockResolvedValue(1);
    await expect(vmCleanupService.cleanup('session', true)).resolves.toBe(false);
    expect(mocks.claims.resolveAttempt).not.toHaveBeenCalled();
  });

  it('blocks legacy restart when an unclaimed name still exists in Fleet', async () => {
    mocks.db.session.findUnique.mockResolvedValue({ vmName: 'unknown-legacy-name' });
    mocks.db.activeVmClaim.findMany.mockResolvedValue([]);
    mocks.fleet.findByName.mockResolvedValue({ id: 'possibly-new-id', name: 'unknown-legacy-name' });
    await expect(vmCleanupService.cleanup('session', true)).resolves.toBe(false);
    expect(mocks.fleet.deleteVmById).not.toHaveBeenCalled();
  });

  it('does not block a known completed cleanup when another VM reuses its historical name', async () => {
    mocks.db.session.findUnique.mockResolvedValue({ vmName: 'reused' });
    mocks.db.activeVmClaim.findMany.mockResolvedValue([]);
    mocks.db.vmAcquisitionAttempt.findFirst.mockResolvedValue({ candidateVmId: 'deleted-old-id' });
    await expect(vmCleanupService.cleanup('session', true)).resolves.toBe(true);
    expect(mocks.fleet.findByName).not.toHaveBeenCalled();
    expect(mocks.fleet.deleteVmById).not.toHaveBeenCalled();
  });
});
