import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RaceActionsService } from '@/modules/sessions/race/race-actions.service.js';
import { RaceStateRepository } from '@/modules/sessions/race/race-state.repository.js';
import { createTestClient, TestDatabase } from './test-database.js';

vi.mock('@/lib/config/env.js', () => ({ env: { DATABASE_URL: 'postgresql://unused' } }));

async function fixtureTask(db: TestDatabase): Promise<string> {
  const task = await db.client.task.create({ data: { title: 'Integration race task', prompt: 'Integration prompt', difficulty: 1 } });
  db.taskIds.add(task.id);
  return task.id;
}

describe('PostgreSQL race invariants', () => {
  it('persists the selected profile key and display name across repository recreation', async () => {
    const db = new TestDatabase();
    const repo = new RaceStateRepository(db.client);
    const id = randomUUID(); db.sessionIds.add(id);
    try {
      await repo.create({ id, taskId: await fixtureTask(db), difficulty: 1, imageId: 'image', title: 'Task', prompt: 'Prompt',
        creationKey: randomUUID(), creationHash: 'profile', modelLabel: 'Qwen 3.8-27B',
        config: { difficulty: 1, agentLeftModel: 'Qwen3.8-27B' } });
      const restored = await new RaceStateRepository(db.client).snapshot(id);
      expect(restored.agentLeftModel).toBe('Qwen3.8-27B');
      expect(restored.race).toMatchObject({ modelId: 'Qwen3.8-27B', modelLabel: 'Qwen 3.8-27B' });
    } finally { await db.cleanup(); }
  });
  it('persists the technical completion policy and can apply it when reconnecting a running arena', async () => {
    const db = new TestDatabase();
    const repo = new RaceStateRepository(db.client);
    const id = randomUUID();
    const technicalId = randomUUID();
    db.sessionIds.add(id); db.sessionIds.add(technicalId);
    try {
      const taskId = await fixtureTask(db);
      const input = { taskId, difficulty: 1, imageId: 'image', title: 'Task', prompt: 'Prompt', creationHash: 'hash' };
      await repo.create({ ...input, id, creationKey: randomUUID() });
      await repo.create({ ...input, id: technicalId, creationKey: randomUUID(), autoFinishOnAgent: false });
      expect((await repo.read(id)).race!.autoFinishOnAgent).toBe(true);
      expect((await repo.snapshot(technicalId)).race.autoFinishOnAgent).toBe(false);
      await repo.prepare(id);
      for (const participant of ['HUMAN', 'AGENT'] as const) {
        await db.client.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant } }, data: {
          vmName: `${id}-${participant}`, guacId: 'fixture', connectArgs: 'fixture',
        } });
        await repo.ready(id, participant, 'fixture');
      }
      await repo.start(id);
      await repo.ready(id, 'HUMAN', 'reconnected', false);
      const restored = await new RaceStateRepository(db.client).snapshot(id);
      expect(restored.status).toBe('RUNNING');
      expect(restored.race.autoFinishOnAgent).toBe(false);
      expect(restored.race.finishedAt).toBeNull();
      await repo.finalize(id, 'USER_STOP');
      expect((await repo.snapshot(id)).race.finishReason).toBe('USER_STOP');
    } finally { await db.cleanup(); }
  });

  it('commits exactly one immutable result for competing HUMAN / AGENT / stop', async () => {
    const db = new TestDatabase();
    const second = createTestClient();
    const a = new RaceStateRepository(db.client);
    const b = new RaceStateRepository(second);
    const id = randomUUID();
    db.sessionIds.add(id);
    try {
      await a.create({ id, taskId: await fixtureTask(db), difficulty: 1, imageId: 'image', title: 'Task', prompt: 'Prompt', creationKey: randomUUID(), creationHash: 'hash' });
      await a.prepare(id);
      for (const participant of ['HUMAN', 'AGENT'] as const) {
        await db.client.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant } }, data: {
          vmName: `${id}-${participant}`, guacId: 'fixture', connectArgs: 'fixture',
        } });
      }
      await a.ready(id, 'HUMAN', 'human-tunnel');
      await a.ready(id, 'AGENT', 'agent-tunnel');
      await a.start(id);
      await Promise.all([
        a.finalize(id, 'HUMAN_FINISHED'), b.finalize(id, 'AGENT_FINISHED'), b.finalize(id, 'USER_STOP'),
      ]);
      const result = await a.snapshot(id);
      expect(result.race.finishedAt).not.toBeNull();
      expect(result.race.participants).toHaveLength(2);
      expect(await db.client.sessionMetrics.count({ where: { sessionId: id } })).toBe(0);
      for (const participant of result.race.participants) {
        expect(participant.metrics.time).toBe(Math.floor(participant.metrics.elapsedMs! / 1000));
      }
      const revision = result.race.revision;
      await a.finalize(id, 'AGENT_FAILED');
      expect((await a.snapshot(id)).race.revision).toBe(revision);
      expect((await a.snapshot(id)).race.finishReason).toBe(result.race.finishReason);
    } finally {
      await second.$disconnect();
      await db.cleanup();
    }
  });
  it('allows pre-start cancellation with null elapsed time and no winner', async () => {
    const db = new TestDatabase();
    const repo = new RaceStateRepository(db.client);
    const id = randomUUID();
    db.sessionIds.add(id);
    try {
      await repo.create({ id, taskId: await fixtureTask(db), difficulty: 1, imageId: 'image', title: 'Task', prompt: 'Prompt', creationKey: randomUUID(), creationHash: 'hash' });
      await repo.finalize(id, 'USER_STOP');
      const { race } = await repo.snapshot(id);
      expect(race.startedAt).toBeNull();
      expect(race.finishedAt).not.toBeNull();
      expect(race.winner).toBeNull();
      expect(race.participants.every((participant) => participant.metrics.elapsedMs === null)).toBe(true);
    } finally { await db.cleanup(); }
  });

  it('atomically rejects conflicting batches, replays terminal duplicates and counts each input only once', async () => {
    const db = new TestDatabase();
    const second = createTestClient();
    const repo = new RaceStateRepository(db.client);
    const actions = new RaceActionsService(repo);
    const competing = new RaceActionsService(new RaceStateRepository(second));
    const id = randomUUID();
    db.sessionIds.add(id);
    const click = { eventId: randomUUID(), occurredAt: '2026-10-09T10:00:00.000Z', kind: 'CLICK',
      details: { x: 0.2, y: 0.3, button: 'left' } };
    try {
      await repo.create({ id, taskId: await fixtureTask(db), difficulty: 1, imageId: 'image', title: 'Task', prompt: 'Prompt',
        creationKey: randomUUID(), creationHash: 'hash' });
      await repo.prepare(id);
      for (const participant of ['HUMAN', 'AGENT'] as const) {
        await db.client.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant } }, data: {
          vmName: `${id}-${participant}`, guacId: 'fixture', connectArgs: 'fixture', agentTaskUuid: 'task-uuid',
        } });
        await repo.ready(id, participant, 'fixture');
      }
      await repo.start(id);
      const ack = await actions.human(id, { events: [click] });
      await expect(actions.human(id, { events: [
        { ...click, eventId: randomUUID() }, { ...click, details: { ...click.details, x: 0.9 } },
      ] })).rejects.toMatchObject({ code: 'ACTION_CONFLICT' });
      expect(await db.client.raceAction.count({ where: { sessionId: id } })).toBe(1);
      const key = { eventId: randomUUID(), occurredAt: click.occurredAt, kind: 'KEY_INPUT', details: { keysym: 97, modifiers: [] } };
      const results = await Promise.all([
        actions.human(id, { events: [click, key] }), competing.human(id, { events: [click, key] }),
      ]);
      expect(results[0]).toEqual(results[1]);
      await actions.agent(id, 'task-uuid', { step: 0, status: 'INCOMPLETE', text: 'Step', ts: Date.now() });
      await actions.agent(id, 'task-uuid', { step: 0, status: 'DONE', text: 'Done', ts: Date.now() });
      const before = await repo.snapshot(id);
      expect(before.race.participants.find((p) => p.participant === 'HUMAN')?.metrics).toMatchObject({
        steps: 2, clicks: 1, eventCount: 2, lastStep: null,
      });
      expect(before.race.participants.find((p) => p.participant === 'AGENT')?.metrics).toMatchObject({
        steps: 1, clicks: null, eventCount: 2, lastStep: 0,
      });
      const drag = { eventId: randomUUID(), occurredAt: click.occurredAt, kind: 'DRAG',
        details: { from: { x: 0.1, y: 0.1 }, to: { x: 0.5, y: 0.5 }, button: 'left' } };
      const repeatedKey = { ...key, eventId: randomUUID() };
      const doubleClick = { ...click, eventId: randomUUID(), details: { ...click.details, count: 2 } };
      const tripleClick = { ...click, eventId: randomUUID(), details: { ...click.details, count: 3 } };
      const batch = { events: [drag, repeatedKey, doubleClick, tripleClick] };
      await actions.human(id, batch);
      await actions.human(id, batch);
      const human = (await repo.snapshot(id)).race.participants.find(p => p.participant === 'HUMAN')!;
      expect(human.metrics).toMatchObject({ steps: 6, clicks: 6, eventCount: 6, lastStep: null });
      await repo.finalize(id, 'HUMAN_FINISHED');
      await expect(db.client.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant: 'HUMAN' } },
        data: { steps: 999 } })).rejects.toThrow('Race participant result is immutable');
      // Durable cleanup is allowed to update only its own fields.
      await db.client.raceParticipant.updateMany({ where: { sessionId: id }, data: { cleanedAt: new Date(), connectArgs: null } });
      await expect(actions.human(id, { events: [click] })).resolves.toMatchObject({ accepted: ack.accepted });
      await expect(actions.human(id, batch)).resolves.toMatchObject({ accepted: expect.any(Array) });
      expect((await repo.snapshot(id)).race.participants.find(p => p.participant === 'HUMAN')?.metrics)
        .toMatchObject({ steps: 6, clicks: 6, eventCount: 6 });
      await expect(actions.human(id, { events: [{ ...click, eventId: randomUUID() }] })).rejects.toMatchObject({ code: 'RACE_NOT_RUNNING' });
      const page = await actions.page(id, 0, 200);
      expect(page.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(await db.client.sessionMetrics.count({ where: { sessionId: id } })).toBe(0);
      expect((await repo.snapshot(id)).race.participants.every((p) => p.connectArgs === null)).toBe(true);
    } finally { await second.$disconnect(); await db.cleanup(); }
  });

  it('projects old terminal results from saved actions without rewriting stored measurements or winner', async () => {
    const db = new TestDatabase(); const repo = new RaceStateRepository(db.client); const id = randomUUID(); db.sessionIds.add(id);
    try {
      await repo.create({ id, taskId: await fixtureTask(db), difficulty: 1, imageId: 'image', title: 'Task', prompt: 'Prompt', creationKey: randomUUID(), creationHash: 'hash' });
      await db.client.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant: 'AGENT' } }, data: { steps: 2, lastStep: 1, clicks: null } });
      for (const [step, status, kind] of [[0, 'INCOMPLETE', 'click'], [1, 'DONE', 'done']] as const) {
        await db.client.raceAction.create({ data: { sessionId: id, participant: 'AGENT', sequence: step + 1, eventId: randomUUID(), kind, step,
          occurredAt: new Date(), details: { status, action_type: kind, action_inputs: {} } } });
      }
      await repo.finalize(id, 'USER_STOP');
      expect((await repo.snapshot(id)).race.participants.find(p => p.participant === 'AGENT')?.metrics).toMatchObject({ steps: 1, clicks: 1, lastStep: 0 });
      expect(await db.client.raceParticipant.findUnique({ where: { sessionId_participant: { sessionId: id, participant: 'AGENT' } } })).toMatchObject({ steps: 2, clicks: null, lastStep: 1 });
      expect((await repo.snapshot(id)).race.winner).toBeNull();
    } finally { await db.cleanup(); }
  });

  it('counts real agent clicks once and excludes terminal outcome steps from immutable results', async () => {
    const db = new TestDatabase(); const repo = new RaceStateRepository(db.client); const actions = new RaceActionsService(repo);
    const id = randomUUID(); db.sessionIds.add(id);
    try {
      await repo.create({ id, taskId: await fixtureTask(db), difficulty: 1, imageId: 'image', title: 'Task', prompt: 'Prompt', creationKey: randomUUID(), creationHash: 'hash' });
      await repo.prepare(id);
      for (const participant of ['HUMAN', 'AGENT'] as const) {
        await db.client.raceParticipant.update({ where: { sessionId_participant: { sessionId: id, participant } }, data: { vmName: participant, guacId: 'fixture', connectArgs: 'fixture', agentTaskUuid: 'task' } });
        await repo.ready(id, participant, 'tunnel');
      }
      await repo.start(id);
      const click = { step: 0, status: 'INCOMPLETE' as const, text: 'Click', ts: Date.now(), action_type: 'click', executedActions: [{ type: 'click', inputs: { count: 2 } }] };
      await actions.agent(id, 'task', click); await actions.agent(id, 'task', click);
      await actions.agent(id, 'task', { ...click, status: 'DONE' });
      await actions.agent(id, 'task', { step: 1, status: 'INCOMPLETE', text: 'Wait', ts: Date.now(), action_type: 'wait', executedActions: [] });
      await actions.agent(id, 'task', { step: 2, status: 'DONE', text: 'Done', ts: Date.now(), action_type: 'done', executedActions: [] });
      await repo.finalize(id, 'AGENT_FINISHED');
      expect((await repo.snapshot(id)).race.participants.find(p => p.participant === 'AGENT')?.metrics).toMatchObject({ steps: 2, clicks: 2, eventCount: 4, lastStep: 1 });
      await actions.agent(id, 'task', { ...click, step: 3 });
      expect((await repo.snapshot(id)).race.participants.find(p => p.participant === 'AGENT')?.metrics).toMatchObject({ steps: 2, clicks: 2 });
    } finally { await db.cleanup(); }
  });

  it('concurrent repeated restart returns one replacement despite different request keys', async () => {
    const db = new TestDatabase(); const other = createTestClient();
    try {
      const a = new RaceStateRepository(db.client), b = new RaceStateRepository(other);
      const taskId = await fixtureTask(db);
      const base = { taskId, difficulty: 1, imageId: 'snapshot', title: 'Task', prompt: 'Prompt', creationHash: 'same' };
      const source = await a.create({ ...base, creationKey: randomUUID() }); db.sessionIds.add(source.id);
      await a.finalize(source.id, 'USER_STOP');
      const config = { difficulty: 1, restartedFromSessionId: source.id };
      const [first, second] = await Promise.all([
        a.create({ ...base, config, creationKey: randomUUID() }), b.create({ ...base, config, creationKey: randomUUID() }),
      ]);
      db.sessionIds.add(first.id); db.sessionIds.add(second.id);
      expect(first.id).toBe(second.id); expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
    } finally { await other.$disconnect(); await db.cleanup(); }
  });

  it('creates one Session under competing keys and preserves its original snapshot', async () => {
    const db = new TestDatabase();
    const other = createTestClient();
    const key = randomUUID();
    const input = { taskId: await fixtureTask(db), difficulty: 1, imageId: 'initial-image', title: 'Initial task', prompt: 'Initial prompt',
      creationKey: key, creationHash: 'initial-hash' };
    try {
      const a = new RaceStateRepository(db.client);
      const b = new RaceStateRepository(other);
      const [first, second] = await Promise.all([a.create(input), b.create(input)]);
      db.sessionIds.add(first.id);
      expect(first.id).toBe(second.id);
      expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
      const replay = await a.create({ ...input, imageId: 'changed-default', title: 'Changed task' });
      expect(replay.race.taskTitle).toBe('Initial task');
      expect((await a.read(first.id)).race?.resolvedImageId).toBe('initial-image');
      await expect(b.create({ ...input, creationHash: 'different-input' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    } finally { await other.$disconnect(); await db.cleanup(); }
  });
});
