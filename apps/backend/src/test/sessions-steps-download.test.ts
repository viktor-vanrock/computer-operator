import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchFullDuplexSteps, findById } = vi.hoisted(() => ({
  fetchFullDuplexSteps: vi.fn(),
  findById: vi.fn(),
}));

vi.mock('@/lib/config/env.js', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    PORT: 3001,
    NODE_ENV: 'test',
    AGENT_MANAGER_API_URL: 'http://agent-manager.test',
    AGENT_MANAGER_USERNAME: 'test-user',
    AGENT_MANAGER_PASSWORD: 'test-password',
    VMFLEET_URL: 'http://vm-fleet.test',
    VMFLEET_TOKEN: 'test-token',
    DEFAULT_IMAGE_ID: 'test-image',
    FULL_DUPLEX_API_URL: 'http://full-duplex.test',
    FULL_DUPLEX_USERNAME: 'test-user',
    FULL_DUPLEX_PASSWORD: 'test-password',
    GUACAMOLE_URL: 'http://guacamole.test',
    GUACAMOLE_ADMIN_USERNAME: 'test-user',
    GUACAMOLE_ADMIN_PASSWORD: 'test-password',
    KEYCLOAK_URL: 'http://keycloak.test',
    KEYCLOAK_REALM: 'test',
    KEYCLOAK_CLIENT_ID: 'test-client',
    KEYCLOAK_CLIENT_SECRET: 'test-secret',
    SESSION_SECRET: 'test-session-secret-that-is-long-enough',
    FRONTEND_TECH_URL: 'http://frontend-tech.test',
    GIGACHAT_AUTHORIZATION_KEY: 'test-key',
    TASK_VALIDATION_SECRET: 'test-task-validation-secret-long-enough',
  },
  isDev: false,
}));

vi.mock('@/lib/agent/agent-manager.client.js', () => ({
  fullDuplexAgentManager: { fetchFullDuplexSteps },
  agentManager: {},
}));
vi.mock('@/lib/auth/require-authenticated-user.js', () => ({ requireAuthenticatedUser: vi.fn() }));
vi.mock('@/modules/moderation/moderation.service.js', () => ({ moderationService: {} }));
vi.mock('@/modules/sessions/sessions.service.js', () => ({ sessionsService: { findById } }));

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

async function buildApp() {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _request, reply) => {
    const typedError = error as Error & { statusCode?: number };
    const statusCode = typedError.statusCode ?? 500;
    return reply.status(statusCode).send({ message: typedError.message });
  });
  const { sessionsRouter } = await import('@/modules/sessions/sessions.router.js');
  await app.register(sessionsRouter, { prefix: '/sessions' });
  return app;
}

describe('GET /sessions/:id/steps.zip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findById.mockResolvedValue({ id: SESSION_ID, mode: 'FULL_DUPLEX' });
  });

  it('передаёт zip-поток и заголовки upstream', async () => {
    fetchFullDuplexSteps.mockResolvedValue(new Response(new Uint8Array([80, 75, 3, 4]), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': 'attachment; filename="session-steps.zip"',
        'content-length': '4',
      },
    }));
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: `/sessions/${SESSION_ID}/steps.zip` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/zip');
    expect(response.headers['content-disposition']).toBe('attachment; filename="session-steps.zip"');
    expect(response.headers['access-control-expose-headers']).toBe('Content-Disposition, Content-Length');
    expect(response.headers['content-length']).toBe('4');
    expect(response.rawPayload).toEqual(Buffer.from([80, 75, 3, 4]));
    expect(fetchFullDuplexSteps).toHaveBeenCalledWith(SESSION_ID, expect.any(AbortSignal));
    await app.close();
  });

  it('отдаёт безопасную ошибку, если upstream вернул ошибочный статус', async () => {
    fetchFullDuplexSteps.mockResolvedValue(new Response('internal upstream details', { status: 500 }));
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: `/sessions/${SESSION_ID}/steps.zip` });

    expect(response.statusCode).toBe(502);
    expect(response.body).not.toContain('internal upstream details');
    await app.close();
  });

  it('отклоняет некорректный sessionId до вызова upstream', async () => {
    const app = await buildApp();

    const response = await app.inject({ method: 'GET', url: '/sessions/not-a-uuid/steps.zip' });

    expect(response.statusCode).toBe(400);
    expect(fetchFullDuplexSteps).not.toHaveBeenCalled();
    await app.close();
  });
});
