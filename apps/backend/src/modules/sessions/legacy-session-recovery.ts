import { prisma } from '@/lib/db/prisma.js';
import { logger } from '@/lib/logger.js';
import { vmFleetClient } from '@/lib/vm-fleet/index.js';
import type { VMFleetVm } from '@/lib/vm-fleet/vm-fleet.types.js';

const log = logger.child({ module: 'sessions' });

/** Called only during exclusive runtime-owner recovery, before starts are enabled. */
export async function recoverLegacySessions(): Promise<void> {
  const stale = await prisma.session.findMany({
    where: { mode: { not: 'HUMAN_VS_AGENT' }, OR: [
      { status: { in: ['PREPARING', 'RUNNING'] } },
      { status: 'PENDING', vmName: { not: null } },
    ] },
    select: { id: true, mode: true, status: true, vmName: true, updatedAt: true },
  });

  // Validate every row before changing statuses. An unavailable Fleet or an
  // existing VM with unproven ownership must not look like completed recovery.
  for (const session of stale) {
    if (!session.vmName) continue;
    const claims = await prisma.activeVmClaim.findMany({ where: { sessionId: session.id } });
    if (claims.some((claim) => claim.vmName === session.vmName)) continue;
    const completed = await prisma.vmAcquisitionAttempt.findFirst({ where: {
      sessionId: session.id, candidateVmName: session.vmName, status: 'COMPLETE', lastErrorCode: null,
    } });
    // COMPLETE assignment persisted its claim atomically. Its absence proves
    // cleanup released it; today's object under the old name is unrelated.
    if (completed) continue;

    const identity = { sessionId: session.id, mode: session.mode, status: session.status, vmName: session.vmName };
    let candidate: VMFleetVm | null;
    try {
      candidate = await vmFleetClient.findByName(session.vmName);
    } catch {
      log.warn({ ...identity, recoveryCode: 'LEGACY_VM_LOOKUP_FAILED' }, 'Legacy VM lookup failed; recovery will retry');
      throw new Error('LEGACY_VM_LOOKUP_FAILED');
    }
    if (candidate) {
      log.error({ ...identity, candidateVmId: candidate.id, recoveryCode: 'LEGACY_VM_IDENTITY_UNKNOWN' },
        'Legacy VM still exists without confirmed ownership; recovery remains blocked');
      throw new Error('LEGACY_VM_IDENTITY_UNKNOWN');
    }
    log.info(identity, 'Fleet confirmed historical VM absent; stale session can be finalized');
  }

  for (const session of stale) {
    const transition = await prisma.session.updateMany({
      where: { id: session.id, status: session.status, vmName: session.vmName, updatedAt: session.updatedAt },
      data: { status: 'FAILED' },
    });
    if (!transition.count) throw new Error('SESSION_RECOVERY_STATE_CHANGED');
  }
}
