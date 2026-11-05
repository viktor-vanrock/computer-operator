import { checkDependencies } from '@/lib/health/dependency-health.js';
import { sessionRuntimeOwner } from '@/lib/session-runtime-owner.js';
import type { FastifyPluginAsync } from 'fastify';

interface HealthOkResponse {
  status: 'ok';
  uptime: number;
  dependencies?: Record<string, boolean>;
}

interface HealthErrorResponse {
  status: 'error';
  uptime: number;
  dependencies: Record<string, boolean>;
}

/**
 * Prefix задаётся в server.ts: /health/live и /health/ready.
 */
export const healthRouter: FastifyPluginAsync = async (app) => {
  app.get<{ Reply: HealthOkResponse }>('/live', async (_req, reply) => {
    return reply.status(200).send({ status: 'ok', uptime: process.uptime() });
  });

  app.get<{ Reply: HealthOkResponse | HealthErrorResponse }>('/ready', async (_req, reply) => {
    const dependencies = { ...await checkDependencies(), runtimeOwner: sessionRuntimeOwner.isReady() };
    if (Object.values(dependencies).every(Boolean)) {
      return reply.status(200).send({ status: 'ok', dependencies, uptime: process.uptime() });
    }
    return reply.status(503).send({ status: 'error', dependencies, uptime: process.uptime() });
  });
};
