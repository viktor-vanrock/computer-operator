import { randomUUID } from 'node:crypto';
import { agentManager } from '@/lib/agent/agent-manager.client.js';
import { guacamoleClient } from '@/lib/guacamole/index.js';
import { sessionRuntimeOwner } from '@/lib/session-runtime-owner.js';
import { runtimeProfile } from '@/modules/sessions/session-profiles.js';
import { SOLO_DEFAULTS } from '@/modules/sessions/sessions.constants.js';
import { vmClaimsService } from '@/modules/sessions/vm-claims/vm-claims.service.js';
import { vmCleanupService } from '@/modules/sessions/vm-claims/vm-cleanup.service.js';
import { raceActionsService } from './race-actions.service.js';
import { raceStateRepository as repo } from './race-state.repository.js';
import type { RaceFinishReason } from './race.types.js';
import type { SoloSessionHandle } from '@/lib/agent/agent-manager.types.js';
import type { Participant } from '@prisma/client';

const handles = new Map<string, SoloSessionHandle>();
const operations = new Map<string, Promise<unknown>>();
const opening = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const heartbeats = new Map<string, () => void>();
// Experimental 150% DPI request for both participants; xrdp/desktop support must be verified live.
const RACE_DPI = 144;
let publish: (id: string) => Promise<void> = async () => {};
let publishAction: (id: string, action: unknown) => void = () => {};

async function exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(id) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  operations.set(id, current);
  try { return await current; } finally { if (operations.get(id) === current) operations.delete(id); }
}

export async function dispatchRaceStop(handle: SoloSessionHandle | undefined, cleanup: () => Promise<unknown>): Promise<void> {
  try { handle?.cancelTask(); } catch { /* Cleanup must still run on a failed send. */ }
  try { handle?.close(); } catch { /* Cleanup must still run on a failed send. */ }
  await cleanup();
}

export const raceCoordinator = {
  drainRuntime(): void {
    for (const handle of handles.values()) {
      try { handle.cancelTask(); } catch { /* Socket may already be closed. */ }
      try { handle.close(); } catch { /* Durable recovery owns subsequent cleanup. */ }
    }
    handles.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    for (const stop of heartbeats.values()) stop();
    heartbeats.clear();
  },
  setPublisher(callback: (id: string) => Promise<void>): void { publish = callback; },
  setActionPublisher(callback: (id: string, action: unknown) => void): void { publishAction = callback; },

  async cleanup(id: string): Promise<void> {
    const complete = await vmCleanupService.cleanup(id, true);
    await repo.locked(id, async (tx, state) => {
      if (!state.race!.finishedAt) return;
      const cleanupStatus = complete ? 'COMPLETE' : 'FAILED';
      if (state.race!.cleanupStatus === cleanupStatus) return;
      await tx.sessionRace.update({ where: { sessionId: id }, data: { cleanupStatus, revision: { increment: 1 } } });
      if (complete) await tx.raceParticipant.updateMany({ where: { sessionId: id }, data: { cleanedAt: new Date(), connectArgs: null } });
    });
    await publish(id);
  },

  async finish(id: string, reason: RaceFinishReason, agentInitiated = false): Promise<void> {
    if (reason === 'HUMAN_FINISHED') sessionRuntimeOwner.requireReady();
    await exclusive(id, async () => {
      if (agentInitiated) {
        const state = await repo.read(id);
        if (state.status === 'RUNNING' && state.race!.autoFinishOnAgent === false) return;
      }
      const committed = await repo.finalize(id, reason);
      if (!committed) return;
      clearTimeout(timers.get(id));
      timers.delete(id);
      heartbeats.get(id)?.(); heartbeats.delete(id);
      const handle = handles.get(id); handles.delete(id);
      // The two sends occur synchronously after the committed result, before
      // awaiting publication or any Fleet operation.
      void dispatchRaceStop(handle, () => this.cleanup(id)).catch(() => {});
      await publish(id);
    });
  },

  async prepare(id: string): Promise<void> {
    sessionRuntimeOwner.requireReady();
    if (!await repo.prepare(id)) return;
    const state = await repo.read(id);
    const preparationAge = state.updatedAt ? Date.now() - state.updatedAt.getTime() : 0;
    timers.set(id, setTimeout(() => {
      void this.finish(id, 'PREPARATION_FAILED').catch(() => {});
    }, Math.max(0, 60_000 - preparationAge)));
    await publish(id);
    try {
      for (const participant of ['HUMAN', 'AGENT'] as const) {
        const vm = await vmClaimsService.acquire(id, participant, state.race!.resolvedImageId);
        const current = await repo.read(id);
        if (current.status !== 'PREPARING' || !sessionRuntimeOwner.isReady()) { await this.cleanup(id); return; }
        const token = await guacamoleClient.getAuthToken();
        const args = guacamoleClient.buildConnectArgs(token, vm.connectionId, { dpi: RACE_DPI });
        const saved = await repo.locked(id, async (tx, fresh) => {
          if (fresh.status !== 'PREPARING') return false;
          await tx.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant } }, data: {
            vmName: vm.vmName, guacId: vm.connectionId, guacAuthToken: token, connectArgs: args,
          } });
          await tx.sessionRace.update({ where: { sessionId: id }, data: { revision: { increment: 1 } } });
          return true;
        });
        if (!saved) { await this.cleanup(id); return; }
        await publish(id);
      }
    } catch { await this.finish(id, 'PREPARATION_FAILED'); }
  },

  async ready(id: string, participant: Participant, tunnelId: string, autoFinishOnAgent?: boolean): Promise<void> {
    sessionRuntimeOwner.requireReady();
    await exclusive(id, () => repo.ready(id, participant, tunnelId, autoFinishOnAgent));
    await publish(id);
    const state = await repo.read(id);
    if (state.status !== 'PREPARING' || state.race!.participants.some((p) => p.status !== 'READY')) return;
    if (opening.has(id) || handles.has(id)) return;
    opening.add(id);
    try {
      const agent = state.race!.participants.find((p) => p.participant === 'AGENT')!;
      if (!agent.guacAuthToken || !agent.guacId || !agent.guacTunnelId || !agent.vmName) throw new Error('PARTICIPANT_NOT_PREPARED');
      const sharing = await guacamoleClient.buildSharingParamsWithTunnel(agent.guacAuthToken, agent.guacId, agent.guacTunnelId);
      const profile = await runtimeProfile(state.agentLeftModel ?? state.race!.modelId);
      await exclusive(id, async () => {
        if (handles.has(id) || (await repo.read(id)).status !== 'PREPARING') return;
        const taskId = randomUUID();
        let steps = Promise.resolve();
        await repo.db.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant: 'AGENT' } }, data: {
          agentTaskUuid: taskId, sharingProfileId: sharing.sharingProfileId,
        } });
        const handle = agentManager.connectSession(id, {
          vmName: agent.vmName!, connectionId: sharing.connectionId, datasource: sharing.datasource, guacToken: sharing.guacToken,
          profile,
          deferredFirstTask: true, configOverride: {
            maxIterations: state.maxIterations ?? SOLO_DEFAULTS.MAX_ITERATIONS,
            modelRetries: state.modelRetries ?? SOLO_DEFAULTS.MODEL_RETRIES,
            mouseClickDelay: state.mouseClickDelay ?? SOLO_DEFAULTS.MOUSE_CLICK_DELAY,
            minOperationDelay: state.minOperationDelay ?? SOLO_DEFAULTS.MIN_OPERATION_DELAY,
          },
        }, { taskId, text: state.race!.taskPrompt }, {
          onOpen: () => { void exclusive(id, async () => {
            sessionRuntimeOwner.requireReady();
            if (!await repo.start(id)) { handle.close(); return; }
            sessionRuntimeOwner.requireReady();
            try { handle.sendTask(state.race!.taskPrompt, taskId); }
            catch { void this.finish(id, 'START_FAILED'); return; }
            clearTimeout(timers.get(id)); timers.delete(id);
            heartbeats.set(id, guacamoleClient.startHeartbeat(agent.guacAuthToken!));
            await publish(id);
          }).catch(() => this.finish(id, 'START_FAILED')); },
          onStep: (payload) => {
            steps = steps.then(async () => {
              const action = await raceActionsService.agent(id, taskId, payload);
              if (!action) return;
              publishAction(id, { ...action,
                occurredAt: action.occurredAt.toISOString(), receivedAt: action.receivedAt.toISOString(),
              });
              if (payload.status === 'DONE') await this.finish(id, 'AGENT_FINISHED', true);
              else if (payload.status !== 'INCOMPLETE') await this.finish(id, 'AGENT_FAILED', true);
              await publish(id);
            }).catch(() => this.finish(id, 'AGENT_FAILED'));
          },
          onDiagnostics: (payload) => { if (['FATAL', 'CRITICAL'].includes(payload.level)) void this.finish(id, 'AGENT_FAILED', true); },
          onClosed: () => { void this.finish(id, 'CONNECTION_LOST', true); },
        });
        handles.set(id, handle);
      });
    } catch { await this.finish(id, 'START_FAILED'); }
    finally { opening.delete(id); }
  },
};
