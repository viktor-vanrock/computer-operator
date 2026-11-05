import { timingSafeEqual } from 'node:crypto';

import fp from 'fastify-plugin';

import { env } from '@/lib/config/env.js';

import type { FastifyPluginAsync } from 'fastify';

function tokenMatches(token: string, expected: string): boolean {
  const tokenBuf = Buffer.from(token);
  const expectedBuf = Buffer.from(expected);
  if (tokenBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(tokenBuf, expectedBuf);
}

/**
 * Fastify-плагин: защищает /metrics от несанкционированного доступа.
 * Разрешает запросы только:
 * - с localhost (127.0.0.1 / ::1)
 * - или с корректным заголовком Authorization: Bearer <token>, если задан METRICS_TOKEN
 */
const metricsAuthPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', (req, reply, done) => {
    if (!req.url.startsWith('/metrics')) {
      done();
      return;
    }

    const remoteAddress = req.socket.remoteAddress ?? '';
    const isLocalhost = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';

    if (isLocalhost) {
      done();
      return;
    }

    if (env.METRICS_TOKEN) {
      const authHeader = req.headers.authorization;
      const token = authHeader?.slice(0, 7).toLowerCase() === 'bearer ' ? authHeader.slice(7) : undefined;
      if (token !== undefined && tokenMatches(token, env.METRICS_TOKEN)) {
        done();
        return;
      }
    }

    void reply.status(403).send({ error: { code: 'FORBIDDEN', message: 'Forbidden' } });
  });
};

export const metricsAuth = fp(metricsAuthPlugin, {
  name: 'metrics-auth',
  fastify: '5.x',
});
