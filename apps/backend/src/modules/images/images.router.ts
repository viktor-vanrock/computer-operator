import { z } from 'zod';

import { BadGatewayException } from '@/lib/http/errors.js';
import { AvailableImageSchema } from './images.schema.js';
import { imagesService } from './images.service.js';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export const imagesRouter: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      schema: {
        response: { 200: z.object({ data: z.array(AvailableImageSchema) }) },
      },
    },
    async () => {
      try {
        const data = await imagesService.findAvailable();
        return { data };
      } catch {
        throw new BadGatewayException('Failed to load available VM images');
      }
    }
  );
};
