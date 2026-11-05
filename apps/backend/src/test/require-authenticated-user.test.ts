import { describe, expect, it, vi } from 'vitest';

import { requireAuthenticatedUser } from '@/lib/auth/require-authenticated-user.js';

describe('requireAuthenticatedUser', () => {
  it('отклоняет анонимный запрос к техническому API', () => {
    const request = { session: { get: vi.fn().mockReturnValue(undefined) } };

    expect(() => requireAuthenticatedUser(request)).toThrow(
      expect.objectContaining({ statusCode: 401, code: 'UNAUTHORIZED' })
    );
  });

  it('пропускает запрос с авторизованной технической сессией', () => {
    const request = { session: { get: vi.fn().mockReturnValue({ sub: 'tech-user' }) } };

    expect(() => requireAuthenticatedUser(request)).not.toThrow();
  });
});
