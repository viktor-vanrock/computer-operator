import { prisma } from '@/lib/db/prisma.js';
import { vmFleetClient } from '@/lib/vm-fleet/index.js';
import { unresolvedAcquisitionStatuses, vmClaimsService } from './vm-claims.service.js';

const cleaning = new Map<string, Promise<boolean>>();

export const vmCleanupService = {
  async retryTerminal(): Promise<void> {
    const terminal = { status: { in: ['COMPLETED', 'FAILED'] as Array<'COMPLETED' | 'FAILED'> } };
    const [claims, attempts] = await Promise.all([
      prisma.activeVmClaim.findMany({ where: { session: terminal }, select: { sessionId: true } }),
      prisma.vmAcquisitionAttempt.findMany({
        where: { session: terminal, status: { in: [...unresolvedAcquisitionStatuses] } }, select: { sessionId: true },
      }),
    ]);
    const sessionIds = new Set([...claims, ...attempts].map((resource) => resource.sessionId));
    await Promise.allSettled([...sessionIds].map((sessionId) => this.cleanup(sessionId)));
  },

  async cleanup(sessionId: string, force = false): Promise<boolean> {
    const previous = cleaning.get(sessionId);
    if (previous) return previous;
    const operation = this.cleanupOnce(sessionId, force);
    cleaning.set(sessionId, operation);
    try {
      return await operation;
    } finally {
      cleaning.delete(sessionId);
    }
  },

  async cleanupOnce(sessionId: string, force: boolean): Promise<boolean> {
    const attempts = await prisma.vmAcquisitionAttempt.findMany({ where: {
      sessionId, status: { in: [...unresolvedAcquisitionStatuses] },
    } });
    if (!vmClaimsService.hasPending(sessionId)) {
      await Promise.allSettled(attempts.map((attempt) => vmClaimsService.resolveAttempt(attempt)));
    }
    const claims = await prisma.activeVmClaim.findMany({ where: { sessionId } });
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { vmName: true } });
    // Legacy terminal rows may still name an assigned VM without a persisted id.
    // Do not declare cleanup complete or delete today's object under that name.
    if (session?.vmName && !claims.some((claim) => claim.vmName === session.vmName)) {
      const knownAcquisition = await prisma.vmAcquisitionAttempt.findFirst({ where: {
        sessionId, candidateVmName: session.vmName, status: 'COMPLETE', lastErrorCode: null,
      } });
      // COMPLETE assignment created its claim atomically. Its absence proves our
      // cleanup previously released it; a newly reused name is unrelated.
      if (!knownAcquisition && await vmFleetClient.findByName(session.vmName)) return false;
    }
    await Promise.all(claims.map(async (claim) => {
      if (!force && claim.nextRetryAt && claim.nextRetryAt.getTime() > Date.now()) return;
      const where = { sessionId, vmName: claim.vmName, vmId: claim.vmId };
      try {
        const locked = await prisma.activeVmClaim.updateMany({ where, data: {
          cleanupStatus: 'PENDING', cleanupAttempts: { increment: 1 },
        } });
        if (locked.count === 0) return;
        await vmFleetClient.deleteVmById(claim.vmId);
        await prisma.activeVmClaim.deleteMany({ where });
        vmFleetClient.releaseReservation(claim.vmName);
      } catch {
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(claim.cleanupAttempts, 5));
        await prisma.activeVmClaim.updateMany({ where, data: {
          cleanupStatus: 'FAILED', nextRetryAt: new Date(Date.now() + delay), lastErrorCode: 'VM_DELETE_FAILED',
        } });
      }
    }));
    const [remainingClaims, unresolved] = await Promise.all([
      prisma.activeVmClaim.count({ where: { sessionId } }),
      prisma.vmAcquisitionAttempt.count({ where: { sessionId, status: { in: [...unresolvedAcquisitionStatuses] } } }),
    ]);
    return remainingClaims === 0 && unresolved === 0;
  },
};
