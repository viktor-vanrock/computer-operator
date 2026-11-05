import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from '@/lib/http/errors.js';
import { countAgentClicks, countsAsAgentStep } from './agent-action-metrics.js';
import { raceStateRepository, RaceStateRepository } from './race-state.repository.js';
import { HumanActionBatchSchema } from './race.schema.js';
import type { SoloStepPayload } from '@/lib/agent/agent-manager.types.js';
import type { Prisma } from '@prisma/client';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().filter((key) => object[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function creationHash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

export class RaceActionsService {
  constructor(private readonly repo: RaceStateRepository = raceStateRepository) {}

  async human(id: string, body: unknown) {
    const { events } = HumanActionBatchSchema.parse(body);
    return this.repo.locked(id, async (tx, state) => {
      const race = state.race!;
      const accepted: Array<{ eventId: string; sequence: number }> = [];
      let sequence = race.nextEventSequence;
      let steps = 0;
      let clicks = 0;
      // Any conflict rolls back the entire transaction including a new prefix.
      for (const event of events) {
        const existing = await tx.raceAction.findUnique({ where: {
          sessionId_participant_eventId: { sessionId: id, participant: 'HUMAN', eventId: event.eventId },
        } });
        if (existing) {
          const previous = {
            eventId: existing.eventId, occurredAt: existing.occurredAt.toISOString(), kind: existing.kind, details: existing.details,
          };
          if (creationHash(previous) !== creationHash({ ...event, occurredAt: new Date(event.occurredAt).toISOString() })) throw new HttpError(409, 'ACTION_CONFLICT', 'Different action with same eventId');
          accepted.push({ eventId: event.eventId, sequence: existing.sequence });
          continue;
        }
        if (state.status !== 'RUNNING') throw new HttpError(409, 'RACE_NOT_RUNNING', 'Race is not running');
        await tx.raceAction.create({ data: {
          sessionId: id, sequence, participant: 'HUMAN', eventId: event.eventId, occurredAt: new Date(event.occurredAt),
          kind: event.kind, details: event.details,
        } });
        accepted.push({ eventId: event.eventId, sequence });
        sequence += 1;
        steps += 1;
        if (event.kind === 'CLICK') clicks += event.details.count ?? 1;
      }
      if (steps) {
        await tx.sessionRace.update({ where: { sessionId: id }, data: { nextEventSequence: sequence } });
        await tx.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant: 'HUMAN' } }, data: {
          steps: { increment: steps }, clicks: { increment: clicks }, eventCount: { increment: steps },
        } });
      }
      return { accepted, lastEventSequence: sequence - 1 };
    });
  }

  async agent(id: string, taskId: string, payload: SoloStepPayload) {
    return this.repo.locked(id, async (tx, state) => {
      const race = state.race!;
      const participant = race.participants.find((p) => p.participant === 'AGENT')!;
      if (state.status !== 'RUNNING' || participant.agentTaskUuid !== taskId) return null;
      const eventId = creationHash({ id, taskId, step: payload.step, status: payload.status });
      const existing = await tx.raceAction.findUnique({ where: {
        sessionId_participant_eventId: { sessionId: id, participant: 'AGENT', eventId },
      } });
      if (existing) return null;
      const previous = await tx.raceAction.findMany({ where: { sessionId: id, participant: 'AGENT', step: payload.step } });
      const previousPayloads = previous.map((event) => event.details as unknown as SoloStepPayload);
      const measuredClicks = countAgentClicks(payload);
      const previousClicks = Math.max(0, ...previousPayloads.map((event) => countAgentClicks(event) ?? 0));
      const clickIncrement = Math.max(0, (measuredClicks ?? 0) - previousClicks);
      const stepIncrement = countsAsAgentStep(payload) && !previousPayloads.some(countsAsAgentStep) ? 1 : 0;
      const action = await tx.raceAction.create({ data: {
        id: randomUUID(), sessionId: id, sequence: race.nextEventSequence, participant: 'AGENT', eventId,
        occurredAt: new Date(payload.ts), kind: payload.action_type ?? 'MESSAGE', text: payload.text, step: payload.step,
        details: JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue,
      } });
      await tx.sessionRace.update({ where: { sessionId: id }, data: { nextEventSequence: { increment: 1 } } });
      await tx.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant: 'AGENT' } }, data: {
        steps: (participant.steps ?? 0) + stepIncrement,
        ...(countsAsAgentStep(payload) ? { lastStep: Math.max(participant.lastStep ?? 0, payload.step) } : {}),
        clicks: measuredClicks === null ? participant.clicks : (participant.clicks ?? 0) + clickIncrement,
        eventCount: { increment: 1 },
      } });
      return action;
    });
  }

  async page(id: string, afterSequence: number, limit: number) {
    await this.repo.read(id);
    const records = await this.repo.db.raceAction.findMany({
      where: { sessionId: id, sequence: { gt: afterSequence } }, orderBy: { sequence: 'asc' }, take: limit + 1,
    });
    const hasMore = records.length > limit;
    const events = records.slice(0, limit).map((event) => ({
      ...event, occurredAt: event.occurredAt.toISOString(), receivedAt: event.receivedAt.toISOString(),
    }));
    return { events, nextAfterSequence: events.at(-1)?.sequence ?? afterSequence, hasMore };
  }
}

export const raceActionsService = new RaceActionsService();
