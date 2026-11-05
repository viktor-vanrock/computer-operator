import { z } from 'zod';

import '../../lib/auth/session.types.js';
import { verifyIdToken } from '../../lib/auth/jwt-verifier.js';
import { env } from '../../lib/config/env.js';
import { UnauthorizedException } from '../../lib/http/errors.js';
import { logger } from '../../lib/logger.js';
import { CurrentUserSchema } from './auth.schema.js';

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

const log = logger.child({ module: 'auth' });

export const authRouter: FastifyPluginAsyncZod = async (app) => {
  // GET /auth/login — редирект на страницу логина Keycloak
  app.get('/login', async (req, reply) => {
    const uri = await app.keycloakOAuth2.generateAuthorizationUri(req, reply);
    return reply.redirect(uri);
  });

  // GET /auth/callback — обмен кода на токен, запись в сессию, редирект на SPA
  app.get(
    '/callback',
    {
      schema: {
        querystring: z.object({
          code:  z.string().optional(),
          state: z.string().optional(),
          error: z.string().optional(),
        }),
      },
    },
    async (req, reply) => {
      if (req.query.error) {
        log.warn({ error: req.query.error }, 'Keycloak returned error on callback');
        return reply.redirect(`${env.FRONTEND_TECH_URL}?auth_error=${encodeURIComponent(req.query.error)}`);
      }

      const token = await app.keycloakOAuth2.getAccessTokenFromAuthorizationCodeFlow(req, reply);

      const idToken = token.token.id_token as string | undefined;
      if (!idToken) throw new UnauthorizedException('No ID token in token response');

      // Верифицируем подпись, iss, aud, exp через JWKS Keycloak
      const claims = await verifyIdToken(idToken);

      const user = {
        sub:               claims.sub,
        email:             claims.email ?? '',
        name:              claims.name ?? claims.preferred_username ?? '',
        preferredUsername: claims.preferred_username ?? claims.email ?? claims.sub,
      };

      req.session.set('user', user);
      req.session.set('idToken', idToken);

      log.info({ sub: user.sub, username: user.preferredUsername }, 'User authenticated');

      return reply.redirect(env.FRONTEND_TECH_URL);
    }
  );

  // GET /auth/logout — сброс сессии и редирект на Keycloak logout
  app.get('/logout', async (req, reply) => {
    const idToken = req.session.get('idToken');
    req.session.delete();
    const logoutUrl = new URL(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/logout`);
    logoutUrl.searchParams.set('post_logout_redirect_uri', env.FRONTEND_TECH_URL);
    logoutUrl.searchParams.set('client_id', env.KEYCLOAK_CLIENT_ID);
    if (idToken) logoutUrl.searchParams.set('id_token_hint', idToken);
    return reply.redirect(logoutUrl.toString());
  });

  // GET /auth/me — текущий пользователь из сессии
  app.get(
    '/me',
    {
      schema: {
        response: { 200: z.object({ data: CurrentUserSchema }) },
      },
    },
    async (req) => {
      const user = req.session.get('user');
      if (!user) throw new UnauthorizedException('Not authenticated');
      return { data: user };
    }
  );
};
