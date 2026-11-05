import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/http/errors.js';

const config = vi.hoisted(() => ({ env: {
  AGENT_MANAGER_API_URL: '', AGENT_MANAGER_USERNAME: 'test-user', AGENT_MANAGER_PASSWORD: 'test-pass',
  FULL_DUPLEX_API_URL: 'http://unused', FULL_DUPLEX_USERNAME: 'user', FULL_DUPLEX_PASSWORD: 'pass', LOG_LEVEL: 'error',
} }));
vi.mock('@/lib/config/env.js', () => ({ ...config, isDev: false }));
vi.mock('@/lib/db/prisma.js', () => ({ prisma: {} }));
vi.mock('@/modules/sessions/sessions.service.js', () => ({ sessionsService: {} }));
vi.mock('@/modules/moderation/moderation.service.js', () => ({ moderationService: {} }));

const upstream = Fastify();
const app = Fastify();
let upstreamStatus = 200;
let upstreamBody = '';
let authorization: string | undefined;
let select: typeof import('@/modules/sessions/session-profiles.js').selectedProfile;
let runtime: typeof import('@/modules/sessions/session-profiles.js').runtimeProfile;

beforeAll(async () => {
  upstream.get('/profiles', (req, reply) => {
    authorization = req.headers.authorization;
    return reply.status(upstreamStatus).type('application/json').send(upstreamBody);
  });
  config.env.AGENT_MANAGER_API_URL = await upstream.listen({ host: '127.0.0.1', port: 0 });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR' } });
  });
  const { sessionsRouter } = await import('@/modules/sessions/sessions.router.js');
  const profiles = await import('@/modules/sessions/session-profiles.js');
  select = profiles.selectedProfile; runtime = profiles.runtimeProfile;
  await app.register(sessionsRouter, { prefix: '/sessions' });
});
beforeEach(() => {
  upstreamStatus = 200;
  upstreamBody = JSON.stringify({
    default: { display_name: 'Computer Operator', internal_config: 'must not leave backend' },
    'server-profile-v2': { display_name: 'New model from server' },
  });
});
afterAll(async () => { await app.close(); await upstream.close(); });

describe('Agent Manager profile catalog over HTTP', () => {
  it('returns actual keys and display_name without exposing upstream configuration', async () => {
    const response = await app.inject({ method: 'GET', url: '/sessions/profiles' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: [
      { id: 'default', displayName: 'Computer Operator' },
      { id: 'server-profile-v2', displayName: 'New model from server' },
    ] });
    expect(authorization).toBe(`Basic ${Buffer.from('test-user:test-pass').toString('base64')}`);
    await expect(select('server-profile-v2')).resolves.toEqual({ id: 'server-profile-v2', displayName: 'New model from server' });
    await expect(select('missing-profile')).rejects.toMatchObject({ statusCode: 400, code: 'MODEL_NOT_SUPPORTED' });
  });

  it('reports an upstream failure instead of returning an invented default model', async () => {
    upstreamStatus = 503;
    const response = await app.inject({ method: 'GET', url: '/sessions/profiles' });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: { code: 'BAD_GATEWAY' } });
    await expect(select('server-profile-v2')).rejects.toMatchObject({ statusCode: 502 });
    await expect(select(undefined)).resolves.toEqual({ id: 'default', displayName: 'Computer Operator' });
  });

  it('preserves legacy default sessions while honoring real profile keys with the same names', async () => {
    await expect(runtime('holo3')).resolves.toBe('default');
    await expect(runtime('computer-operator')).resolves.toBe('default');
    await expect(select('holo3')).resolves.toEqual({ id: 'default', displayName: 'Computer Operator' });
    upstreamBody = JSON.stringify({ holo3: { display_name: 'Actual Holo3' }, 'computer-operator': { display_name: 'Actual Operator' } });
    await expect(runtime('holo3')).resolves.toBe('holo3');
    await expect(runtime('computer-operator')).resolves.toBe('computer-operator');
    await expect(select('holo3')).resolves.toEqual({ id: 'holo3', displayName: 'Actual Holo3' });
    upstreamStatus = 503;
    await expect(runtime('holo3')).resolves.toBe('default');
    await expect(select('computer-operator')).resolves.toEqual({ id: 'default', displayName: 'Computer Operator' });
  });

  it('validates display_name and keeps an empty catalog empty', async () => {
    upstreamBody = '{"default":{"display_name":42}}';
    expect((await app.inject({ method: 'GET', url: '/sessions/profiles' })).statusCode).toBe(502);
    upstreamBody = '{}';
    const response = await app.inject({ method: 'GET', url: '/sessions/profiles' });
    expect(response.json()).toEqual({ data: [] });
  });
});
