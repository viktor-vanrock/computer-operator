const BASE_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001';

export const AUTH_LOGIN_URL  = `${BASE_URL}/auth/login`;
export const AUTH_LOGOUT_URL = `${BASE_URL}/auth/logout`;

export interface CurrentUser {
  sub: string;
  email: string;
  name: string;
  preferredUsername: string;
}

class AuthError extends Error {
  constructor(public readonly status: number) {
    super('Auth error');
    this.name = 'AuthError';
  }
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const res = await fetch(`${BASE_URL}/auth/me`, { credentials: 'include' });
  if (!res.ok) throw new AuthError(res.status);
  const json = await res.json() as { data: CurrentUser };
  return json.data;
}

export { AuthError };
