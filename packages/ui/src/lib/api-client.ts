/**
 * Типизированный HTTP-клиент.
 *
 * Backend возвращает { data } или { error: { code, message } }
 */

export const BASE_URL = import.meta.env['VITE_API_URL'] ?? 'http://localhost:3001';

class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (undefined !== init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });

  const json = 204 === res.status ? null : await res.json();

  if (!res.ok) {
    const errObj = json?.error;
    // Поддерживаем два формата:
    // наш:       { error: { code, message } }
    // Fastify:   { code, error: "Bad Request", message }
    const errObjTyped = ('object' === typeof errObj && errObj !== null)
      ? (errObj as Record<string, unknown>)
      : null;
    const code = errObjTyped?.code ?? json?.code ?? 'UNKNOWN';
    const message = errObjTyped?.message ?? json?.message ?? 'Unknown error';
    throw new ApiError(String(code), String(message), res.status);
  }

  return (204 === res.status ? undefined : (json as { data: T }).data) as T;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown, headers?: HeadersInit) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers } : {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
};

export { ApiError };
