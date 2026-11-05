import { Readable } from 'node:stream';
import { z } from 'zod';
import { fullDuplexAgentManager } from '@/lib/agent/agent-manager.client.js';
import { AvailableAgentProfileSchema } from '@/lib/agent/agent-profiles.schema.js';
import { requireAuthenticatedUser } from '@/lib/auth/require-authenticated-user.js';
import { BadGatewayException, BadRequestException } from '@/lib/http/errors.js';
import { moderationService } from '@/modules/moderation/moderation.service.js';
import { creationHash, raceActionsService } from './race/race-actions.service.js';
import { HumanActionBatchSchema, parseCreationKey, RaceActionPageSchema } from './race/race.schema.js';
import { availableProfiles } from './session-profiles.js';
import { CreateSessionSchema, NextTaskSchema, SessionSchema, UpdateSessionSchema } from './sessions.schema.js';
import { sessionsService } from './sessions.service.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const sessionsRouter: FastifyPluginAsyncZod = async (app) => {
  const intents = new WeakMap<object, unknown>();
  app.get('/profiles', {
    schema: { response: { 200: z.object({ data: z.array(AvailableAgentProfileSchema) }) } },
  }, async () => ({ data: await availableProfiles() }));

  // POST /sessions — создать сессию
  app.post(
    '/',
    {
      preValidation: async (req) => {
        const raw = req.body as Record<string, unknown>;
        const validation = CreateSessionSchema.safeParse(raw);
        if (!validation.success) return;
        const validated = validation.data;
        intents.set(req, Object.fromEntries(Object.entries(validated).filter(([key]) => Object.hasOwn(raw, key))));
      },
      schema: {
        body: CreateSessionSchema,
        response: { 201: z.object({ data: SessionSchema }), 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req, reply) => {
      const rawHeaderCount = req.raw.rawHeaders.filter((value, index) =>
        index % 2 === 0 && value.toLowerCase() === 'idempotency-key').length;
      const key = parseCreationKey(rawHeaderCount > 1 ? [] : req.headers['idempotency-key'], req.body.mode === 'HUMAN_VS_AGENT');
      const data = await sessionsService.create(req.body, key, creationHash(intents.get(req)));
      reply.status(key && !sessionsService.wasCreated(data) ? 200 : 201);
      return { data };
    }
  );

  // GET /sessions/:id
  app.get(
    '/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req) => {
      const data = await sessionsService.findById(req.params.id);
      return { data };
    }
  );

  // GET /sessions/:id/steps.zip — потоково скачать логи Full Duplex-сессии.
  app.get(
    '/:id/steps.zip',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      requireAuthenticatedUser(req);
      const session = await sessionsService.findById(req.params.id);
      if (session.mode !== 'FULL_DUPLEX') {
        throw new BadRequestException('Logs are available only for Full Duplex sessions');
      }

      const controller = new AbortController();
      const abortIfClientDisconnected = () => {
        if (!reply.raw.writableFinished) controller.abort();
      };
      reply.raw.once('close', abortIfClientDisconnected);

      let upstream: Response;
      try {
        upstream = await fullDuplexAgentManager.fetchFullDuplexSteps(session.id, controller.signal);
      } catch (error) {
        reply.raw.off('close', abortIfClientDisconnected);
        if (controller.signal.aborted) throw error;
        req.log.error({ err: error, sessionId: session.id }, 'Full Duplex logs request failed');
        throw new BadGatewayException('Failed to download Full Duplex session logs');
      }

      if (!upstream.ok) {
        reply.raw.off('close', abortIfClientDisconnected);
        await upstream.body?.cancel();
        throw new BadGatewayException(`Full Duplex logs request failed (${upstream.status})`);
      }
      if (!upstream.body) {
        reply.raw.off('close', abortIfClientDisconnected);
        throw new BadGatewayException('Full Duplex logs response was empty');
      }

      reply.raw.once('finish', () => reply.raw.off('close', abortIfClientDisconnected));
      reply
        .header('Content-Type', upstream.headers.get('content-type') ?? 'application/zip')
        .header('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length')
        .header('Content-Disposition', upstream.headers.get('content-disposition') ?? `attachment; filename="steps-${session.id}.zip"`);
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) reply.header('Content-Length', contentLength);
      return reply.send(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream<Uint8Array>));
    }
  );

  // PATCH /sessions/:id — обновить статус или метрики
  app.patch(
    '/:id',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: UpdateSessionSchema,
        response: { 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req) => {
      const data = await sessionsService.update(req.params.id, req.body);
      return { data };
    }
  );

  // POST /sessions/:id/start — запустить агента
  app.post(
    '/:id/start',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req) => {
      const data = await sessionsService.startAgent(req.params.id);
      return { data };
    }
  );

  // POST /sessions/:id/next-task — запустить следующую задачу на той же VM
  app.post(
    '/:id/next-task',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: NextTaskSchema,
        response: { 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req) => {
      const isTrustedTechUser = Boolean(req.session.get('user'));
      const taskDescription = isTrustedTechUser
        ? req.body.taskDescription.trim()
        : moderationService.requireValidated(req.body.taskDescription, req.body.validationToken);
      const data = await sessionsService.startNextTask(req.params.id, taskDescription);
      return { data };
    }
  );

  // POST /sessions/:id/stop-task — остановить текущую задачу агента (VM остаётся живой)
  app.post(
    '/:id/stop-task',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await sessionsService.stopTask(req.params.id);
      return { ok: true };
    }
  );

  // POST /sessions/:id/message — отправить TASK-сообщение в открытую Full Duplex-сессию
  app.post(
    '/:id/message',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ text: z.string().trim().min(1), validationToken: z.string().min(1).optional() }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const text = req.session.get('user')
        ? req.body.text.trim()
        : moderationService.requireValidated(req.body.text, req.body.validationToken);
      await sessionsService.sendFullDuplexMessage(req.params.id, text);
      return { ok: true };
    }
  );

  // POST /sessions/:id/guacamole-ready — фронтенд подключился к Guacamole, запускаем агента.
  // tunnelId получен фронтендом напрямую от клиентского Guacamole-туннеля (tunnel.uuid) —
  // избавляет бэкенд от опроса /activeConnections и связанного race condition.
  app.post(
    '/:id/guacamole-ready',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          tunnelId: z.string().optional(),
          participant: z.enum(['HUMAN', 'AGENT']).optional(),
          autoFinishOnAgent: z.boolean().optional(),
        }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      const state = await sessionsService.findById(req.params.id);
      if (state.mode === 'HUMAN_VS_AGENT') {
        if (!req.body.participant || !req.body.tunnelId) throw new BadRequestException('participant and tunnelId required');
        const { raceCoordinator } = await import('./race/race-coordinator.js');
        await raceCoordinator.ready(req.params.id, req.body.participant, req.body.tunnelId, req.body.autoFinishOnAgent);
      } else sessionsService.completeAgentStart(req.params.id, req.body.tunnelId).catch(() => {/* логируется внутри */});
      return { ok: true };
    }
  );

  // Клиентский Guacamole-туннель закрылся или так и не показал кадр. Это
  // отдельный от /stop путь: /stop означает явное штатное завершение и для
  // RUNNING-сессии даёт COMPLETED, тогда как здесь сессия должна стать FAILED.
  app.post(
    '/:id/guacamole-error',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ participant: z.enum(['HUMAN', 'AGENT']).optional(),
          code: z.enum(['GUACAMOLE_CONNECTION_LOST', 'GUACAMOLE_SCREEN_TIMEOUT']).optional() }).optional(),
        response: { 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req) => {
      const state = await sessionsService.findById(req.params.id);
      if (state.mode === 'HUMAN_VS_AGENT' && (!req.body?.participant || !req.body.code)) {
        throw new BadRequestException('participant and code required');
      }
      return { data: await sessionsService.failGuacamoleConnection(req.params.id) };
    }
  );

  // POST /sessions/:id/stop — остановить агента
  app.post(
    '/:id/stop',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req, reply) => {
      const data = await sessionsService.stopAgent(req.params.id);
      return reply.send({ data });
    }
  );

  // POST /sessions/:id/restart — завершить старую и создать новую с теми же параметрами
  app.post(
    '/:id/restart',
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ data: SessionSchema }) },
      },
    },
    async (req) => {
      const data = await sessionsService.restart(req.params.id);
      return { data };
    }
  );
  app.post('/:id/human-complete', { schema: { params: z.object({ id: z.uuid() }) } }, async (req) => {
    const { raceCoordinator } = await import('./race/race-coordinator.js');
    await raceCoordinator.finish(req.params.id, 'HUMAN_FINISHED');
    return { data: await sessionsService.findById(req.params.id) };
  });
  app.post('/:id/human-actions', { schema: {
    params: z.object({ id: z.uuid() }), body: HumanActionBatchSchema,
  } }, async (req) => {
    const data = await raceActionsService.human(req.params.id, req.body);
    const { broadcast } = await import('../arena/arena.router.js');
    const { WsEventSchema } = await import('../arena/arena.schema.js');
    const first = Math.min(...data.accepted.map((accepted) => accepted.sequence));
    const page = await raceActionsService.page(req.params.id, first - 1, 200);
    const eventIds = new Set(data.accepted.map((accepted) => accepted.eventId));
    for (const action of page.events) {
      if (eventIds.has(action.eventId)) broadcast(req.params.id, WsEventSchema.parse({
        type: 'RACE_ACTION', payload: { sessionId: req.params.id, action },
      }));
    }
    return { data };
  });
  app.get('/:id/actions', { schema: {
    params: z.object({ id: z.uuid() }), querystring: RaceActionPageSchema,
  } }, async (req) => ({ data: await raceActionsService.page(req.params.id, req.query.afterSequence, req.query.limit) }));
};
