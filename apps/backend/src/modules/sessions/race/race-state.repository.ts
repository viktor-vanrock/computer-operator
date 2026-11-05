import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma.js';
import { HttpError, NotFoundException } from '@/lib/http/errors.js';
import { summarizeAgentActions } from './agent-action-metrics.js';
import { serializeRace } from './race.serializer.js';
import type { RaceFinishReason, RawRaceState } from './race.types.js';
import type { Participant, Prisma, PrismaClient } from '@prisma/client';

const include = { race: { include: { participants: true } }, metrics: true } as const;
interface Creation {
  id?: string; taskId: string; difficulty: number; imageId: string; title: string; prompt: string;
  creationKey: string; creationHash: string; config?: Prisma.SessionUncheckedCreateInput;
  autoFinishOnAgent?: boolean; modelLabel?: string;
}

export class RaceStateRepository {
  constructor(readonly db: PrismaClient = prisma) {}

  async read(id: string): Promise<RawRaceState> {
    const state = await this.db.$transaction((tx) => tx.session.findUnique({ where: { id }, include }), {
      isolationLevel: 'RepeatableRead',
    });
    if (!state) throw new NotFoundException('Session not found');
    if (!state.race) throw new HttpError(409, 'SESSION_MODE_MISMATCH', 'Session is not a race');
    return state;
  }

  async snapshot(id: string) {
    return this.db.$transaction(async (tx) => {
      const state = await tx.session.findUnique({ where: { id }, include });
      if (!state) throw new NotFoundException('Session not found');
      if (!state.race) throw new HttpError(409, 'SESSION_MODE_MISMATCH', 'Session is not a race');
      const actions = await tx.raceAction.findMany({ where: { sessionId: id, participant: 'AGENT' }, select: { step: true, details: true } });
      const race = serializeRace(state);
      const agent = race.participants.find((participant) => participant.participant === 'AGENT');
      if (agent && actions.length) Object.assign(agent.metrics, summarizeAgentActions(actions));
      return { ...state, race };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async create(input: Creation) {
    const replay = await this.db.session.findUnique({ where: { creationKey: input.creationKey } });
    if (replay) {
      if (replay.creationHash !== input.creationHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Different creation intent');
      return { ...await this.snapshot(replay.id), created: false };
    }
    try {
      const state = await this.db.session.create({ data: {
        ...input.config, id: input.id ?? randomUUID(), taskId: input.taskId, difficulty: input.difficulty,
        mode: 'HUMAN_VS_AGENT', resolvedImageId: input.imageId, creationKey: input.creationKey, creationHash: input.creationHash,
        race: { create: {
          modelId: input.config?.agentLeftModel ?? 'computer-operator',
          modelLabel: input.modelLabel ?? 'Computer Operator',
          autoFinishOnAgent: input.autoFinishOnAgent ?? true,
          taskTitle: input.title, taskPrompt: input.prompt, resolvedImageId: input.imageId,
          participants: { create: [
            { participant: 'HUMAN', steps: 0, clicks: 0 }, { participant: 'AGENT' },
          ] },
        } },
      }, include });
      return { ...state, race: serializeRace(state), created: true };
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        const saved = await this.db.session.findUnique({ where: { creationKey: input.creationKey } });
        if (saved && saved.creationHash === input.creationHash) return { ...await this.snapshot(saved.id), created: false };
        if (saved) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Different creation intent');
        if (input.config?.restartedFromSessionId) {
          const replacement = await this.db.session.findUnique({ where: { restartedFromSessionId: input.config.restartedFromSessionId } });
          if (replacement) return { ...await this.snapshot(replacement.id), created: false };
        }
      }
      throw err;
    }
  }

  async locked<T>(id: string, run: (tx: Prisma.TransactionClient, state: RawRaceState) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "sessionId" FROM "SessionRace" WHERE "sessionId" = ${id} FOR UPDATE`;
      const state = await tx.session.findUnique({ where: { id }, include });
      if (!state) throw new NotFoundException('Session not found');
      if (!state.race) throw new HttpError(409, 'SESSION_MODE_MISMATCH', 'Session is not a race');
      return run(tx, state);
    });
  }

  async prepare(id: string): Promise<boolean> {
    return this.locked(id, async (tx, state) => {
      if (state.status !== 'PENDING') return false;
      await tx.session.update({ where: { id }, data: { status: 'PREPARING' } });
      await tx.sessionRace.update({ where: { sessionId: id }, data: { revision: { increment: 1 }, cleanupStatus: 'PENDING' } });
      return true;
    });
  }

  async ready(id: string, participant: Participant, tunnelId: string, autoFinishOnAgent?: boolean): Promise<boolean> {
    return this.locked(id, async (tx, state) => {
      if (!state.race!.finishedAt && autoFinishOnAgent !== undefined && state.race!.autoFinishOnAgent !== autoFinishOnAgent) {
        await tx.sessionRace.update({ where: { sessionId: id }, data: { autoFinishOnAgent, revision: { increment: 1 } } });
      }
      if (state.status !== 'PREPARING') return false;
      const p = state.race!.participants.find((entry) => entry.participant === participant)!;
      if (!p.vmName || !p.guacId || !p.connectArgs) throw new HttpError(409, 'PARTICIPANT_NOT_PREPARED', 'Viewer is not prepared');
      if (p.readyAt) return false;
      await tx.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant } }, data: {
        status: 'READY', readyAt: new Date(), guacTunnelId: tunnelId,
      } });
      await tx.sessionRace.update({ where: { sessionId: id }, data: { revision: { increment: 1 } } });
      return true;
    });
  }

  async start(id: string): Promise<boolean> {
    return this.locked(id, async (tx, state) => {
      if (state.status !== 'PREPARING' || state.race!.participants.some((p) => p.status !== 'READY')) return false;
      await tx.session.update({ where: { id }, data: { status: 'RUNNING' } });
      await tx.sessionRace.update({ where: { sessionId: id }, data: { startedAt: new Date(), revision: { increment: 1 } } });
      await tx.raceParticipant.updateMany({ where: { sessionId: id }, data: { status: 'RUNNING' } });
      return true;
    });
  }

  async finalize(id: string, reason: RaceFinishReason, errorCode: string | null = null): Promise<boolean> {
    return this.locked(id, async (tx, state) => {
      if (state.race!.finishedAt) return false;
      const winner = reason === 'HUMAN_FINISHED' ? 'HUMAN' : reason === 'AGENT_FINISHED' ? 'AGENT' : null;
      if (winner && state.status !== 'RUNNING') throw new HttpError(409, 'RACE_NOT_RUNNING', 'Race has not started');
      const failed = !winner && reason !== 'USER_STOP';
      const finishedAt = new Date();
      await tx.session.update({ where: { id }, data: { status: failed ? 'FAILED' : 'COMPLETED' } });
      await tx.sessionRace.update({ where: { sessionId: id }, data: {
        winner, finishReason: reason, finishedAt, cleanupStatus: 'PENDING', errorCode, revision: { increment: 1 },
      } });
      for (const p of state.race!.participants) {
        await tx.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant: p.participant } }, data: {
          endedAt: finishedAt, status: winner === p.participant ? 'SUCCEEDED'
            : failed && p.participant === 'AGENT' && reason === 'AGENT_FAILED' ? 'FAILED' : 'STOPPED',
        } });
      }
      return true;
    });
  }
}

export const raceStateRepository = new RaceStateRepository();
