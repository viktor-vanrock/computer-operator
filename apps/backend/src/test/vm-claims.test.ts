import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { vmClaimsService } from '@/modules/sessions/vm-claims/vm-claims.service.js';

const mocks = vi.hoisted(() => ({
  db: {
    session: { findUnique: vi.fn() },
    activeVmClaim: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    vmAcquisitionAttempt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
  },
  fleet: { reserveAvailable: vi.fn(), assignCandidate: vi.fn(), deleteVmById: vi.fn() },
}));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: mocks.db }));
vi.mock('@/lib/vm-fleet/index.js', () => ({ vmFleetClient: mocks.fleet }));

const candidate = { id: 'vm-id', name: 'vm-name' };
const assigned = { vmId: candidate.id, vmName: candidate.name, connectionId: '42', status: 'ready' };

describe('durable VM acquisition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.db.$transaction.mockImplementation(async (operation) => operation(mocks.db));
    mocks.db.vmAcquisitionAttempt.findFirst.mockResolvedValue(null);
    mocks.db.activeVmClaim.findFirst.mockResolvedValue(null);
    mocks.db.activeVmClaim.findUnique.mockResolvedValue(null);
    mocks.db.vmAcquisitionAttempt.create.mockImplementation(async ({ data }) => ({ id: 'intent', ...data }));
    mocks.db.activeVmClaim.create.mockImplementation(async ({ data }) => data);
  });
  afterEach(() => vi.restoreAllMocks());

  it('journals candidate and assign key before POST; saves assignment and claim together', async () => {
    mocks.fleet.reserveAvailable.mockImplementation(async (_image, _excluded, lifecycle) => {
      expect(await lifecycle.onCandidate(candidate, 'key')).toBe(true);
      expect(mocks.db.vmAcquisitionAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ candidateVmId: candidate.id, assignIdempotencyKey: 'key', status: 'PENDING' }),
      }));
      await lifecycle.onAssigned(assigned);
      return assigned;
    });
    await expect(vmClaimsService.acquire('session', 'AGENT', 'image')).resolves.toEqual(assigned);
    expect(mocks.db.activeVmClaim.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ sessionId: 'session', participant: 'AGENT', vmId: candidate.id }),
    }));
    expect(mocks.db.vmAcquisitionAttempt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'COMPLETE' }),
    }));
  });

  it('skips a VM claimed by another mode/participant before assignment', async () => {
    mocks.db.activeVmClaim.findFirst.mockResolvedValue({ sessionId: 'other', participant: 'HUMAN', vmId: candidate.id });
    mocks.fleet.reserveAvailable.mockImplementation(async (_image, _excluded, lifecycle) => {
      expect(await lifecycle.onCandidate(candidate, 'key')).toBe(false);
      throw new Error('No available VM');
    });
    await expect(vmClaimsService.acquire('session', 'AGENT', 'image')).rejects.toThrow('No available');
    expect(mocks.db.vmAcquisitionAttempt.create).not.toHaveBeenCalled();
    expect(mocks.fleet.deleteVmById).not.toHaveBeenCalled();
  });

  it('leaves timeout intent unresolved and replays the same candidate/key after a crash', async () => {
    const attempt = {
      id: 'intent', sessionId: 'session', participant: 'AGENT', candidateVmId: candidate.id,
      candidateVmName: candidate.name, assignIdempotencyKey: 'old-key', status: 'PENDING',
    };
    mocks.db.vmAcquisitionAttempt.findFirst.mockResolvedValue(attempt);
    mocks.fleet.assignCandidate.mockRejectedValue(new Error('timeout'));
    await expect(vmClaimsService.acquire('session', 'AGENT', 'image')).rejects.toThrow('timeout');
    expect(mocks.fleet.reserveAvailable).not.toHaveBeenCalled();
    expect(mocks.fleet.assignCandidate).toHaveBeenCalledWith(candidate.id, candidate.name, 'old-key');
    mocks.fleet.assignCandidate.mockResolvedValue(assigned);
    await expect(vmClaimsService.acquire('session', 'AGENT', 'image')).resolves.toEqual(assigned);
    expect(mocks.db.vmAcquisitionAttempt.create).not.toHaveBeenCalled();
  });

  it('does not delete or steal a foreign claim after assignment conflicts', async () => {
    mocks.fleet.reserveAvailable.mockImplementation(async (_image, _excluded, lifecycle) => {
      await lifecycle.onCandidate(candidate, 'key');
      mocks.db.activeVmClaim.findFirst.mockResolvedValue({ sessionId: 'other', participant: 'HUMAN', vmId: candidate.id });
      await lifecycle.onAssigned(assigned);
      return assigned;
    });
    await expect(vmClaimsService.acquire('session', 'AGENT', 'image')).rejects.toThrow('VM_OWNERSHIP_CONFLICT');
    expect(mocks.fleet.deleteVmById).not.toHaveBeenCalled();
    expect(mocks.db.activeVmClaim.create).not.toHaveBeenCalled();
  });

  it('recovers confirmed HTTP 200 even when the response body was lost', async () => {
    mocks.db.vmAcquisitionAttempt.findFirst.mockResolvedValue({
      id: 'intent', sessionId: 'session', participant: 'AGENT', candidateVmId: candidate.id,
      candidateVmName: candidate.name, assignIdempotencyKey: 'key', status: 'ASSIGNED',
    });
    await expect(vmClaimsService.acquire('session', 'AGENT', 'image')).rejects.toThrow('ACQUISITION_RESPONSE_LOST');
    expect(mocks.fleet.assignCandidate).not.toHaveBeenCalled();
    expect(mocks.db.activeVmClaim.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vmId: candidate.id }),
    }));
  });
});
