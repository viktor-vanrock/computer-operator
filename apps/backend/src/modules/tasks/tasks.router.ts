import { z } from 'zod';

import { requireAuthenticatedUser } from '@/lib/auth/require-authenticated-user.js';
import { moderationService } from '@/modules/moderation/moderation.service.js';

import {
  AdminTaskSchema,
  CreatePresetTaskSchema,
  CreateTaskSchema,
  ImportPresetTasksSchema,
  TaskSchema,
  UpdatePresetTaskSchema,
} from './tasks.schema.js';
import { tasksService } from './tasks.service.js';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const tasksRouter: FastifyPluginAsyncZod = async (app) => {
  const TaskIdParams = z.object({ id: z.string().uuid() });

  // Admin-маршруты объявлены до /:id, чтобы литерал "admin" не перехватывался UUID-маршрутом.
  app.get(
    '/admin/presets',
    { schema: { response: { 200: z.object({ data: z.array(AdminTaskSchema) }) } } },
    async (req) => {
      requireAuthenticatedUser(req);
      return { data: await tasksService.findAllPresetForAdmin() };
    }
  );

  app.post(
    '/admin/presets',
    {
      schema: {
        body: CreatePresetTaskSchema,
        response: { 201: z.object({ data: AdminTaskSchema }) },
      },
    },
    async (req, reply) => {
      requireAuthenticatedUser(req);
      const data = await tasksService.createPreset(req.body);
      return reply.status(201).send({ data });
    }
  );

  app.post(
    '/admin/presets/import',
    {
      schema: {
        body: ImportPresetTasksSchema,
        response: { 201: z.object({ data: z.array(AdminTaskSchema) }) },
      },
    },
    async (req, reply) => {
      requireAuthenticatedUser(req);
      const data = await tasksService.importPresets(req.body.tasks);
      return reply.status(201).send({ data });
    }
  );

  app.patch(
    '/admin/presets/:id',
    {
      schema: {
        params: TaskIdParams,
        body: UpdatePresetTaskSchema,
        response: { 200: z.object({ data: AdminTaskSchema }) },
      },
    },
    async (req) => {
      requireAuthenticatedUser(req);
      return { data: await tasksService.updatePreset(req.params.id, req.body) };
    }
  );

  app.delete(
    '/admin/presets/:id',
    { schema: { params: TaskIdParams } },
    async (req, reply) => {
      requireAuthenticatedUser(req);
      await tasksService.deletePreset(req.params.id);
      return reply.status(204).send();
    }
  );

  // GET /tasks — список preset-задач
  app.get(
    '/',
    {
      schema: {
        response: { 200: z.object({ data: z.array(TaskSchema) }) },
      },
    },
    async () => {
      const data = await tasksService.findAllPreset();
      return { data };
    }
  );

  // GET /tasks/random — возвращает случайную preset-задачу
  app.get(
    '/random',
    {
      schema: {
        response: { 200: z.object({ data: TaskSchema }) },
      },
    },
    async () => {
      const data = await tasksService.findRandomPreset();
      return { data };
    }
  );

  // GET /tasks/:id — получить задачу по ID
  app.get(
    '/:id',
    {
      schema: {
        params: TaskIdParams,
        response: { 200: z.object({ data: TaskSchema }) },
      },
    },
    async (req) => {
      const data = await tasksService.findPublicById(req.params.id);
      return { data };
    }
  );

  // POST /tasks — создать задачу вручную
  app.post(
    '/',
    {
      schema: {
        body: CreateTaskSchema,
        response: { 201: z.object({ data: TaskSchema }) },
      },
    },
    async (req, reply) => {
      const isTrustedTechUser = Boolean(req.session.get('user'));
      const prompt = isTrustedTechUser
        ? req.body.prompt.trim()
        : moderationService.requireValidated(req.body.prompt, req.body.validationToken);
      const data = await tasksService.create({
        // На demo title и prompt — один пользовательский ввод. Для анонимного
        // запроса сохраняем именно подтверждённый текст, чтобы непроверенный
        // title нельзя было подменить прямым вызовом API.
        title: isTrustedTechUser ? req.body.title.trim() : prompt,
        prompt,
        imageId: req.body.imageId,
        difficulty: req.body.difficulty,
      });
      reply.status(201);
      return { data };
    }
  );

};
