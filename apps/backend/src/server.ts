import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { LogController } from 'fastify';
import fastifyMetrics from 'fastify-metrics';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { keycloakOAuthPlugin } from './lib/auth/oauth.plugin.js';
import './lib/auth/session.types.js';
import { sessionPlugin } from './lib/auth/session.plugin.js';
import { env } from './lib/config/env.js';
import { startKeepalive, stopKeepalive } from './lib/db/prisma.js';
import { startDependencyMonitoring, stopDependencyMonitoring } from './lib/health/dependency-health.js';
import { correlationId } from './lib/http/correlation-id.js';
import { HttpError } from './lib/http/errors.js';
import { requestLogger } from './lib/http/request-logger.js';
import { logger } from './lib/logger.js';
import { metricsAuth } from './lib/metrics/metrics-auth.js';
import { sessionRuntimeOwner } from './lib/session-runtime-owner.js';
import { arenaRouter } from './modules/arena/arena.router.js';
import { authRouter } from './modules/auth/auth.router.js';
import { healthRouter } from './modules/health/health.router.js';
import { imagesRouter } from './modules/images/images.router.js';
import { moderationRouter } from './modules/moderation/moderation.router.js';
import { recoverRacesCleanup } from './modules/sessions/race/race-recovery.js';
import { sessionsRouter } from './modules/sessions/sessions.router.js';
import { sessionsService } from './modules/sessions/sessions.service.js';
import { vmCleanupService } from './modules/sessions/vm-claims/vm-cleanup.service.js';
import { tasksRouter } from './modules/tasks/tasks.router.js';

import type { FastifyError } from 'fastify';

async function build() {
  const app = Fastify({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true }),
    routerOptions: { ignoreTrailingSlash: true },
  });

  // Zod как валидатор и сериализатор
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(correlationId);
  await app.register(requestLogger);
  await app.register(metricsAuth);

  await app.register(fastifyMetrics, { endpoint: '/metrics' });

  await app.register(sessionPlugin);
  await app.register(keycloakOAuthPlugin);

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(websocket);

  // Health check
  await app.register(healthRouter, { prefix: '/health' });

  // Регистрируем домены с префиксами
  await app.register(authRouter, { prefix: '/auth' });
  await app.register(imagesRouter, { prefix: '/images' });
  await app.register(moderationRouter, { prefix: '/moderation' });
  await app.register(tasksRouter, { prefix: '/tasks' });
  await app.register(sessionsRouter, { prefix: '/sessions' });
  await app.register(arenaRouter, { prefix: '/ws' });

  // Глобальный обработчик ошибок — единый формат { error: { code, message } }
  app.setErrorHandler((error: FastifyError | HttpError, _req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    const statusCode = error.statusCode ?? 500;
    app.log.error(error);
    return reply.status(statusCode).send({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: statusCode === 500 ? 'Internal server error' : error.message,
      },
    });
  });

  return app;
}

async function start() {
  const app = await build();
  let runtimeAttempting = false;
  let shuttingDown = false;
  const recoverOwner = async () => {
    if (runtimeAttempting || shuttingDown || sessionRuntimeOwner.isReady()) return;
    runtimeAttempting = true;
    try {
      await sessionRuntimeOwner.start(() => sessionsService.recoverRuntime(), () => sessionsService.drainRuntime());
    } catch (err) {
      app.log.error({ err }, 'Runtime owner recovery failed; starts remain disabled');
    } finally {
      runtimeAttempting = false;
    }
  };
  const ownerRetry = setInterval(() => { void recoverOwner(); }, 5000);
  ownerRetry.unref();
  const cleanupRetry = setInterval(() => {
    if (!sessionRuntimeOwner.isReady() || shuttingDown) return;
    void vmCleanupService.retryTerminal().catch((err: unknown) => app.log.warn({ err }, 'Cleanup retry failed'));
    void recoverRacesCleanup().catch((err: unknown) => app.log.warn({ err }, 'Race cleanup retry failed'));
  }, 5000);
  cleanupRetry.unref();

  // Graceful shutdown — закрываем соединения с БД при остановке сервера
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down...`);
    shuttingDown = true;
    clearInterval(ownerRetry);
    clearInterval(cleanupRetry);
    sessionRuntimeOwner.suspend();
    sessionsService.drainRuntime();
    stopKeepalive();
    stopDependencyMonitoring();
    await Promise.race([
      app.close(),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await sessionRuntimeOwner.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.on('SIGINT', () => { void shutdown('SIGINT'); });

  // Глобальные обработчики необработанных ошибок
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  await recoverOwner();

  startKeepalive();

  // Недоступная внешняя зависимость не должна завершать выставочный backend.
  // Readiness остаётся красным и автоматически восстановится в фоне.
  await startDependencyMonitoring();
}

void start();
