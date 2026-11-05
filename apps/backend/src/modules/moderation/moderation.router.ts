import { z } from 'zod';

import { ModerationValidateSchema, ModerationValidationResponseSchema } from './moderation.schema.js';
import { moderationService } from './moderation.service.js';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const moderationRouter: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/validate',
    {
      schema: {
        body: ModerationValidateSchema,
        response: { 200: z.object({ data: ModerationValidationResponseSchema }) },
      },
    },
    async (request) => {
      const abortController = new AbortController();
      const abort = () => abortController.abort();
      request.raw.once('aborted', abort);
      try {
        const data = await moderationService.validate(request.body.text, abortController.signal);
        return { data };
      } finally {
        request.raw.removeListener('aborted', abort);
      }
    }
  );
};
