import { UnauthorizedException } from '@/lib/http/errors.js';

interface RequestWithSession {
  session: {
    get: (key: 'user') => unknown;
  };
}

export function requireAuthenticatedUser(request: RequestWithSession): void {
  if (!request.session.get('user')) {
    throw new UnauthorizedException('Not authenticated');
  }
}
