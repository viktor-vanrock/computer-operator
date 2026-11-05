import oauthPlugin from '@fastify/oauth2';
import fp from 'fastify-plugin';

import { env } from '../config/env.js';

import type { FastifyInstance } from 'fastify';

export const keycloakOAuthPlugin = fp(async (app: FastifyInstance) => {
  await app.register(oauthPlugin, {
    name:        'keycloakOAuth2',
    credentials: {
      client: {
        id:     env.KEYCLOAK_CLIENT_ID,
        secret: env.KEYCLOAK_CLIENT_SECRET,
      },
      auth: {
        authorizeHost: env.KEYCLOAK_URL,
        authorizePath: `/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/auth`,
        tokenHost:     env.KEYCLOAK_URL,
        tokenPath:     `/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      },
    },
    callbackUri: `${env.BACKEND_URL ?? `http://localhost:${env.PORT}`}/auth/callback`,
    scope:       ['openid', 'email', 'profile'],
    pkce:        'S256',
  });
});
