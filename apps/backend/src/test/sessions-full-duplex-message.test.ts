import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/http/errors.js';
import { TaskValidationTokenService } from '@/modules/moderation/task-validation-token.service.js';
import { requireValidatedTaskText } from '@/modules/moderation/task-validation.js';

const mocks = vi.hoisted(() => ({ send: vi.fn(), validated: vi.fn(), fetchLogs: vi.fn() }));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: {} }));
vi.mock('@/lib/config/env.js', () => ({ env: { DEFAULT_IMAGE_ID: 'test-image' } }));
vi.mock('@/lib/agent/agent-manager.client.js', () => ({ fullDuplexAgentManager: { fetchFullDuplexSteps: mocks.fetchLogs } }));
vi.mock('@/modules/sessions/sessions.service.js', () => ({ sessionsService: { sendFullDuplexMessage: mocks.send } }));
vi.mock('@/modules/moderation/moderation.service.js', () => ({ moderationService: { requireValidated: mocks.validated } }));
import { sessionsRouter } from '@/modules/sessions/sessions.router.js';

const id = '11111111-1111-4111-8111-111111111111';
let tokenNow = Date.now();
const tokens = new TaskValidationTokenService({ secret: 'isolated-test-secret-at-least-32-characters', ttlMs: 1000 }, () => tokenNow);
const apps: Array<ReturnType<typeof Fastify>> = [];
async function build(trusted = false) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler);
  app.addHook('onRequest', async (request) => { Object.assign(request, { session: { get: () => trusted ? { id: 'tester' } : undefined } }); });
  app.setErrorHandler((error, _req, reply) => reply.status(error instanceof HttpError ? error.statusCode : 400).send({ error: { code: error instanceof HttpError ? error.code : 'INVALID', message: error instanceof Error ? error.message : 'Invalid request' } }));
  await app.register(sessionsRouter, { prefix: '/sessions' }); apps.push(app); return app;
}
beforeEach(() => {
  vi.clearAllMocks(); tokenNow = Date.now();
  mocks.validated.mockImplementation((text, token) => requireValidatedTaskText(text, token, tokens));
  mocks.send.mockResolvedValue(undefined);
});
afterEach(async () => { vi.useRealTimers(); await Promise.all(apps.splice(0).map(a => a.close())); });

describe('Full Duplex message authorization', () => {
  it('anonymous validates the exact trimmed text for every message', async () => {
    const app = await build();
    for (const text of ['Открой меню', 'Закрой меню']) {
      const response = await app.inject({ method: 'POST', url: `/sessions/${id}/message`, payload: { text: `  ${text}  `, validationToken: tokens.issue(text) } });
      expect(response.statusCode).toBe(200);
      expect(mocks.send).toHaveBeenLastCalledWith(id, text);
    }
    expect(mocks.validated).toHaveBeenCalledTimes(2);
  });
  it.each(['missing', 'mismatched', 'expired'])('rejects %s validation without dispatch', async (kind) => {
    const app = await build();

    const token = kind === 'missing' ? undefined : tokens.issue(kind === 'mismatched' ? 'Другой запрос' : 'Открой меню');
    if (kind === 'expired') tokenNow += 2000;
    const response = await app.inject({ method: 'POST', url: `/sessions/${id}/message`, payload: { text: 'Открой меню', validationToken: token } });
    expect(response.statusCode).toBe(400); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('trusted tech bypasses moderation but still trims', async () => {
    const app = await build(true);
    expect((await app.inject({ method: 'POST', url: `/sessions/${id}/message`, payload: { text: '  Открой меню  ' } })).statusCode).toBe(200);
    expect(mocks.validated).not.toHaveBeenCalled(); expect(mocks.send).toHaveBeenCalledWith(id, 'Открой меню');
  });
  it('keeps logs authenticated and empty text invalid', async () => {
    const app = await build();
    expect((await app.inject({ method: 'GET', url: `/sessions/${id}/steps.zip` })).statusCode).toBe(401);
    expect(mocks.fetchLogs).not.toHaveBeenCalled();
    expect((await app.inject({ method: 'POST', url: `/sessions/${id}/message`, payload: { text: '  ' } })).statusCode).toBe(400);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
