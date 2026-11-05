import { createRemoteJWKSet, jwtVerify } from 'jose';

import { env } from '../config/env.js';
import { UnauthorizedException } from '../http/errors.js';

const issuer = `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}`;

const JWKS = createRemoteJWKSet(
  new URL(`${issuer}/protocol/openid-connect/certs`)
);

export interface IdTokenClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
}

export async function verifyIdToken(idToken: string): Promise<IdTokenClaims> {
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer,
      audience: env.KEYCLOAK_CLIENT_ID,
    });
    return payload as IdTokenClaims;
  } catch {
    throw new UnauthorizedException('Token verification failed');
  }
}
