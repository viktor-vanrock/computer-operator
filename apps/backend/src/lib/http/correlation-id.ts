import fp from 'fastify-plugin';

import type { FastifyPluginAsync } from 'fastify';

const HEADER = 'x-request-id';

/**
 * Fastify-плагин: присваивает каждому запросу уникальный Correlation ID.
 * Читает X-Request-ID из входящего заголовка или генерирует crypto.randomUUID().
 * Прокидывает ID как reqId в логи и возвращает заголовком X-Request-ID в ответе.
 */
const SKIP_PATHS = new Set(['/metrics']);

const correlationIdPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onRequest', (req, reply, done) => {
    if (SKIP_PATHS.has(req.url)) {
      done();
      return;
    }

    const incoming = req.headers[HEADER];
    const requestId = Array.isArray(incoming)
      ? (incoming[0] ?? crypto.randomUUID())
      : (incoming ?? crypto.randomUUID());

    // Перезаписываем reqId, чтобы все логи запроса несли correlation ID
    req.id = requestId;
    void reply.header(HEADER, requestId);
    done();
  });
};

export const correlationId = fp(correlationIdPlugin, {
  name: 'correlation-id',
  fastify: '5.x',
});
