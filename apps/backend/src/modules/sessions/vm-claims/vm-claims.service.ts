import { prisma } from '@/lib/db/prisma.js';
import { vmFleetClient } from '@/lib/vm-fleet/index.js';
import { VMFleetApiError } from '@/lib/vm-fleet/vm-fleet.types.js';
import type { ReservedVm } from '@/lib/vm-fleet/vm-fleet.types.js';
import type { Participant, VmAcquisitionAttempt } from '@prisma/client';

export const unresolvedAcquisitionStatuses = ['PENDING', 'ASSIGNED', 'COMPENSATING'] as const;
const pending = new Map<string, Promise<ReservedVm>>();

async function persistAssignment(attempt: VmAcquisitionAttempt, vm: ReservedVm, complete = true): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const owner = await tx.activeVmClaim.findFirst({ where: { OR: [{ vmName: vm.vmName }, { vmId: vm.vmId }] } });
      if (owner && (owner.sessionId !== attempt.sessionId || owner.participant !== attempt.participant || owner.vmId !== vm.vmId)) {
        throw new Error('VM_OWNERSHIP_CONFLICT');
      }
      if (!owner) {
        await tx.activeVmClaim.create({ data: {
          vmName: vm.vmName, vmId: vm.vmId, sessionId: attempt.sessionId, participant: attempt.participant,
        } });
      }
      await tx.vmAcquisitionAttempt.update({
        where: { id: attempt.id }, data: { status: complete ? 'COMPLETE' : 'ASSIGNED', lastErrorCode: null },
      });
    });
  } catch (err) {
    // An authoritative foreign claim never grants permission to compensate it.
    const owner = await prisma.activeVmClaim.findFirst({ where: { OR: [{ vmName: vm.vmName }, { vmId: vm.vmId }] } });
    if (owner && (owner.sessionId !== attempt.sessionId || owner.participant !== attempt.participant)) {
      await prisma.vmAcquisitionAttempt.update({ where: { id: attempt.id }, data: {
        status: owner.vmId === vm.vmId ? 'COMPLETE' : 'COMPENSATING', lastErrorCode: 'VM_OWNERSHIP_CONFLICT',
      } });
    } else if (!owner) {
      const existingRole = await prisma.activeVmClaim.findUnique({ where: {
        sessionId_participant: { sessionId: attempt.sessionId, participant: attempt.participant },
      } });
      if (existingRole && existingRole.vmId !== vm.vmId) {
        await prisma.vmAcquisitionAttempt.update({ where: { id: attempt.id }, data: {
          status: 'COMPENSATING', lastErrorCode: 'PARTICIPANT_ALREADY_OWNS_VM',
        } });
      }
    }
    throw err;
  }
}

export const vmClaimsService = {
  hasPending(sessionId: string): boolean {
    return [...pending.keys()].some((key) => key.startsWith(`${sessionId}:`));
  },

  async resolveAttempt(attempt: VmAcquisitionAttempt): Promise<ReservedVm | null> {
    try {
      if (attempt.status === 'COMPENSATING') {
        const owner = await prisma.activeVmClaim.findFirst({ where: { vmId: attempt.candidateVmId } });
        if (!owner || owner.sessionId === attempt.sessionId) await vmFleetClient.deleteVmById(attempt.candidateVmId);
        await prisma.vmAcquisitionAttempt.update({ where: { id: attempt.id }, data: { status: 'COMPLETE' } });
        return null;
      }
      if (attempt.status === 'ASSIGNED') {
        const confirmed = {
          vmId: attempt.candidateVmId, vmName: attempt.candidateVmName, status: 'assigned', connectionId: '',
        };
        await persistAssignment(attempt, confirmed);
        return confirmed;
      }
      const vm = await vmFleetClient.assignCandidate(attempt.candidateVmId, attempt.candidateVmName, attempt.assignIdempotencyKey);
      await persistAssignment(attempt, vm);
      return vm;
    } catch (err) {
      if (err instanceof Error && err.message === 'VM_OWNERSHIP_CONFLICT') throw err;
      if (err instanceof VMFleetApiError && (err.status === 404
        || (err.status === 409 && (err.apiCode === 'already_assigned' || err.apiCode === 'invalid_state')))) {
        await prisma.vmAcquisitionAttempt.update({ where: { id: attempt.id }, data: { status: 'UNAVAILABLE' } });
        return null;
      }
      // Retain uncertainty. Neither a new candidate nor name-based deletion is safe.
      await prisma.vmAcquisitionAttempt.update({ where: { id: attempt.id }, data: { lastErrorCode: 'ASSIGNMENT_UNRESOLVED' } });
      throw err;
    }
  },

  async acquire(sessionId: string, participant: Participant, image: string): Promise<ReservedVm> {
    const key = `${sessionId}:${participant}`;
    const running = pending.get(key);
    if (running) return running;
    const operation = this.acquireOnce(sessionId, participant, image);
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      pending.delete(key);
    }
  },

  async acquireOnce(sessionId: string, participant: Participant, image: string): Promise<ReservedVm> {
    const previous = await prisma.vmAcquisitionAttempt.findFirst({
      where: { sessionId, participant, status: { in: [...unresolvedAcquisitionStatuses] } },
      orderBy: { createdAt: 'asc' },
    });
    if (previous) {
      const recovered = await this.resolveAttempt(previous);
      if (recovered) {
        if (!recovered.connectionId) throw new Error('ACQUISITION_RESPONSE_LOST');
        return recovered;
      }
    }
    const existing = await prisma.activeVmClaim.findUnique({ where: { sessionId_participant: { sessionId, participant } } });
    if (existing) throw new Error('VM_ALREADY_ACQUIRED');
    let attempt: VmAcquisitionAttempt | null = null;
    return vmFleetClient.reserveAvailable(image, new Set(), {
      onCandidate: async (candidate, assignKey) => {
        const owner = await prisma.activeVmClaim.findFirst({
          where: { OR: [{ vmName: candidate.name }, { vmId: candidate.id }] },
        });
        if (owner) return false;
        try {
          attempt = await prisma.vmAcquisitionAttempt.create({ data: {
            sessionId, participant, candidateVmId: candidate.id, candidateVmName: candidate.name,
            assignIdempotencyKey: assignKey, status: 'PENDING',
          } });
        } catch (err) {
          // Partial unique indexes reserve the unresolved candidate across sessions
          // before Fleet POST. Another owner's intent is skipped, never stolen.
          if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') return false;
          throw err;
        }
        return true;
      },
      onAssigned: async (vm) => {
        if (!attempt) throw new Error('ACQUISITION_INTENT_MISSING');
        await persistAssignment(attempt, vm);
      },
      onAssignmentConfirmed: async (candidate) => {
        if (!attempt) throw new Error('ACQUISITION_INTENT_MISSING');
        await persistAssignment(attempt, {
          vmId: candidate.id, vmName: candidate.name, status: 'assigned', connectionId: '',
        }, false);
      },
      onUnavailable: async () => {
        if (!attempt) return;
        await prisma.vmAcquisitionAttempt.update({ where: { id: attempt.id }, data: { status: 'UNAVAILABLE' } });
      },
    });
  },
};
