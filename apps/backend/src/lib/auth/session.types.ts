import type { CurrentUser } from '../../modules/auth/auth.schema.js';
import type { OAuth2Namespace } from '@fastify/oauth2';


declare module '@fastify/secure-session' {
  interface SessionData {
    user: CurrentUser;
    idToken?: string;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    keycloakOAuth2: OAuth2Namespace;
  }
}
