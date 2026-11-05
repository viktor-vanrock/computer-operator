import { describe, expect, it, vi } from 'vitest';

import { GigaChatTaskModerator } from '@/modules/moderation/gigachat-task.moderator.js';

const config = {
  authorizationKey: 'secret',
  scope: 'GIGACHAT_API_CORP',
  authUrl: 'https://auth.test/oauth',
  apiUrl: 'https://chat.test/api/v1',
  model: 'GigaChat-2',
  timeoutMs: 5_000,
  maxTaskLength: 4_000,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('GigaChatTaskModerator.checkHealth', () => {
  it('проверяет OAuth без выполнения chat completion', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 })
    );
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.checkHealth()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      config.authUrl,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('возвращает false при недоступности OAuth', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.checkHealth()).resolves.toBe(false);
  });
});
