import cookie from '@fastify/cookie';
import secureSession from '@fastify/secure-session';
import fp from 'fastify-plugin';

import { env } from '../config/env.js';

import type { FastifyInstance } from 'fastify';

export const sessionPlugin = fp(async (app: FastifyInstance) => {
  await app.register(cookie);
  await app.register(secureSession, {
    secret: env.SESSION_SECRET,
    salt:   'arena_tech_sess_',
    cookie: {
      path:     '/',
      httpOnly: true,
      sameSite: 'lax',
      secure:   env.NODE_ENV === 'production',
    },
  });
});
