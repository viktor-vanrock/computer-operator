import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/http/errors.js';
import { parseCreationKey, RaceCreateSchema } from '@/modules/sessions/race/race.schema.js';

const contract = vi.hoisted(() => ({
  create: vi.fn(), findById: vi.fn(), ready: vi.fn(), finish: vi.fn(), wasCreated: vi.fn(), failGuacamoleConnection: vi.fn(),
}));
vi.mock('@/lib/config/env.js', () => ({ env: { DEFAULT_IMAGE_ID: 'image' } }));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: {} }));
vi.mock('@/lib/agent/agent-manager.client.js', () => ({ fullDuplexAgentManager: {} }));
vi.mock('@/modules/moderation/moderation.service.js', () => ({ moderationService: {} }));
vi.mock('@/modules/sessions/sessions.service.js', () => ({ sessionsService: contract }));
vi.mock('@/modules/sessions/race/race-coordinator.js', () => ({ raceCoordinator: { ready: contract.ready, finish: contract.finish } }));

import { sessionsRouter } from '@/modules/sessions/sessions.router.js';

const key = '11111111-1111-4111-8111-111111111111';

const apps: Array<ReturnType<typeof Fastify>> = [];
async function app() {
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    return reply.status(400).send({ error: { code: 'BAD_REQUEST', message: 'Invalid input' } });
  });
  await server.register(sessionsRouter, { prefix: '/sessions' });
  apps.push(server);
  return server;
}
beforeEach(() => vi.clearAllMocks());
afterEach(async () => { await Promise.all(apps.splice(0).map((server) => server.close())); });

describe('race creation contract', () => {
  it('requires a single UUID creation key only for race; preserves legacy absence', () => {
    expect(() => parseCreationKey(undefined, true)).toThrow('IDEMPOTENCY_KEY_REQUIRED');
    expect(() => parseCreationKey('invalid', true)).toThrow('IDEMPOTENCY_KEY_INVALID');
    expect(() => parseCreationKey([key, key], true)).toThrow('IDEMPOTENCY_KEY_INVALID');
    expect(parseCreationKey(key, true)).toBe(key);
    expect(parseCreationKey(undefined, false)).toBeNull();
  });
  it('requires task, accepts dynamic profile keys and preserves omitted fields for hashing', () => {
    expect(RaceCreateSchema.safeParse({ difficulty: 1, arenaOs: 'ubuntu2204' }).success).toBe(false);
    const input = { taskId: key, difficulty: 1, arenaOs: 'ubuntu2204' };
    expect(RaceCreateSchema.safeParse({ ...input, agentLeftModel: 'server-profile-v2' }).success).toBe(true);
    expect(RaceCreateSchema.parse(input)).not.toHaveProperty('maxIterations');
    expect(RaceCreateSchema.parse(input)).not.toHaveProperty('agentLeftModel');
  });

  it('rejects missing/invalid/multiple race keys and malformed profile IDs before any create', async () => {
    const server = await app();
    const body = { taskId: key, mode: 'HUMAN_VS_AGENT', difficulty: 1, arenaOs: 'ubuntu2204' };
    const missing = await server.inject({ method: 'POST', url: '/sessions', payload: body });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    for (const header of ['invalid', `${key}, ${key}`]) {
      const invalid = await server.inject({ method: 'POST', url: '/sessions', payload: body, headers: { 'idempotency-key': header } });
      expect(invalid.json().error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    }
    const model = await server.inject({ method: 'POST', url: '/sessions', payload: { ...body, agentLeftModel: '' },
      headers: { 'idempotency-key': key } });
    expect(model.statusCode).toBe(400);
    expect(contract.create).not.toHaveBeenCalled();
  });

  it('keeps legacy creation without a key and requires scoped race readiness', async () => {
    const server = await app();
    contract.create.mockRejectedValue(new HttpError(409, 'TEST_DISPATCHED', 'Create was dispatched'));
    const legacy = await server.inject({ method: 'POST', url: '/sessions', payload: {
      taskId: key, mode: 'SOLO', difficulty: 1, arenaOs: 'ubuntu2204',
    } });
    expect(legacy.statusCode).toBe(409);
    expect(contract.create).toHaveBeenCalledWith(expect.objectContaining({ mode: 'SOLO' }), null, expect.any(String));
    contract.findById.mockResolvedValue({ mode: 'HUMAN_VS_AGENT' });
    const invalid = await server.inject({ method: 'POST', url: `/sessions/${key}/guacamole-ready`, payload: { tunnelId: 'tunnel' } });
    expect(invalid.statusCode).toBe(400);
    expect(contract.ready).not.toHaveBeenCalled();
    const ready = await server.inject({ method: 'POST', url: `/sessions/${key}/guacamole-ready`, payload: { participant: 'HUMAN', tunnelId: 'tunnel' } });
    expect(ready.statusCode).toBe(200);
    expect(contract.ready).toHaveBeenCalledWith(key, 'HUMAN', 'tunnel', undefined);
  });
  it('accepts the technical arena policy on creation and readiness, but rejects it for other modes', async () => {
    const server = await app();
    contract.create.mockRejectedValue(new HttpError(409, 'TEST_DISPATCHED', 'Create was dispatched'));
    const body = { taskId: key, mode: 'HUMAN_VS_AGENT', difficulty: 1, arenaOs: 'ubuntu2204', autoFinishOnAgent: false };
    await server.inject({ method: 'POST', url: '/sessions', payload: body, headers: { 'idempotency-key': key } });
    expect(contract.create).toHaveBeenCalledWith(expect.objectContaining({ autoFinishOnAgent: false }), key, expect.any(String));
    contract.create.mockClear();
    for (const mode of ['SOLO', 'FULL_DUPLEX']) {
      const invalid = await server.inject({ method: 'POST', url: '/sessions', payload: { ...body, mode } });
      expect(invalid.statusCode).toBe(400);
    }
    expect(contract.create).not.toHaveBeenCalled();
    contract.findById.mockResolvedValue({ mode: 'HUMAN_VS_AGENT' });
    const ready = await server.inject({ method: 'POST', url: `/sessions/${key}/guacamole-ready`, payload: {
      participant: 'HUMAN', tunnelId: 'tunnel', autoFinishOnAgent: false,
    } });
    expect(ready.statusCode).toBe(200);
    expect(contract.ready).toHaveBeenCalledWith(key, 'HUMAN', 'tunnel', false);
    const invalid = await server.inject({ method: 'POST', url: `/sessions/${key}/guacamole-ready`, payload: {
      participant: 'HUMAN', tunnelId: 'tunnel', autoFinishOnAgent: 'false',
    } });
    expect(invalid.statusCode).toBe(400);
    expect(contract.ready).toHaveBeenCalledOnce();
  });
});

describe('race command routes', () => {
  it('validates participant error and delegates completion without client winner data', async () => {
    const server = await app();
    contract.findById.mockResolvedValue({ mode: 'HUMAN_VS_AGENT' });
    const error = await server.inject({ method: 'POST', url: `/sessions/${key}/guacamole-error`, payload: { code: 'GUACAMOLE_CONNECTION_LOST' } });
    expect(error.statusCode).toBe(400); expect(contract.failGuacamoleConnection).not.toHaveBeenCalled();
    await server.inject({ method: 'POST', url: `/sessions/${key}/human-complete`, payload: { winner: 'AGENT' } });
    expect(contract.finish).toHaveBeenCalledWith(key, 'HUMAN_FINISHED');
  });
  it('returns 201 on initial create and 200 on replay with the same key/hash', async () => {
    const server = await app();
    const now = '2026-10-09T00:00:00.000Z';
    const session = { id: key, taskId: key, mode: 'HUMAN_VS_AGENT', status: 'PENDING', difficulty: 1, metrics: [], createdAt: now, updatedAt: now,
      ...Object.fromEntries(['connectArgs','guacAuthToken','guacTunnelId','vmName','guacId','agentTaskUuid','agentJobId','arenaOs',
        'customImageId','historyMaxStepsCount','maxScreenshotsDelay','maxIterations','modelRetries','mouseClickDelay','minOperationDelay',
        'agentLeftModel','sharingProfileId'].map(field => [field, null])) };
    contract.create.mockResolvedValue(session); contract.wasCreated.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const body = { taskId: key, mode: 'HUMAN_VS_AGENT', difficulty: 1, arenaOs: 'ubuntu2204' };
    const first = await server.inject({ method: 'POST', url: '/sessions', payload: body, headers: { 'idempotency-key': key } });
    const replay = await server.inject({ method: 'POST', url: '/sessions', payload: body, headers: { 'idempotency-key': key } });
    expect(first.statusCode).toBe(201);expect(replay.statusCode).toBe(200);
    expect(contract.create.mock.calls.at(-1)).toEqual(contract.create.mock.calls.at(-2));
    expect(replay.json().data).not.toHaveProperty('creationKey'); expect(replay.json().data).not.toHaveProperty('creationHash');
  });
});

describe('safe race snapshot serializer', () => {
  it('does not expose runtime secrets and preserves unknown metrics', async () => {
    const { serializeRace } = await import('@/modules/sessions/race/race.serializer.js');
    const now = new Date();
    const participant = { participant: 'HUMAN', status: 'WAITING', connectArgs: 'viewer-args', readyAt: null, endedAt: null,
      steps: 0, clicks: 0, lastStep: null, eventCount: 0, guacAuthToken: 'private-admin', sharingProfileId: 'private-sharing' };
    const snapshot = serializeRace({ race: { revision: 0, startedAt: null, finishedAt: null, winner: null, finishReason: null,
      cleanupStatus: 'NOT_REQUIRED', errorCode: null, errorMessage: null, taskTitle: 'Task', modelId: 'computer-operator',
      modelLabel: 'Computer Operator', nextEventSequence: 1,
      participants: [participant, { ...participant, participant: 'AGENT', steps: null, clicks: null }],
    }, createdAt: now } as never);
    expect(JSON.stringify(snapshot)).not.toMatch(/private-admin|private-sharing/);
    expect(snapshot.participants[0]?.metrics).toMatchObject({ steps: 0, elapsedMs: null, time: null });
    expect(snapshot.participants[1]?.metrics).toMatchObject({ steps: null, clicks: null });
  });
});
