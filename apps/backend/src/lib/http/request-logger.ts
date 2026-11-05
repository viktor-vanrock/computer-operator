import fp from 'fastify-plugin';

import type { FastifyPluginAsync } from 'fastify';

const IGNORED_PATHS = new Set(['/metrics']);

function isClientError(error: { statusCode?: number }): boolean {
  return 'number' === typeof error.statusCode && error.statusCode >= 400 && error.statusCode < 500;
}

const requestLoggerPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('onError', (req, _reply, error, done) => {
    if (IGNORED_PATHS.has(req.url)) {
      done();
      return;
    }

    // Клиентские ошибки (401/400/404/...) — штатное поведение API, не баг сервера.
    // Логируем коротко, без stack trace, чтобы не засорять error-лог.
    if (isClientError(error)) {
      req.log.warn(
        { reqId: req.id, method: req.method, url: req.url, statusCode: error.statusCode, message: error.message },
        'request client error'
      );
      done();
      return;
    }

    req.log.error(
      { reqId: req.id, method: req.method, url: req.url, err: error },
      'request error'
    );
    done();
  });
};

export const requestLogger = fp(requestLoggerPlugin, {
  name: 'request-logger',
  fastify: '5.x',
});
