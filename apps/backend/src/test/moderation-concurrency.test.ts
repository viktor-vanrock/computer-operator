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

describe('GigaChatTaskModerator under concurrent load', () => {
  it('использует один общий OAuth refresh для параллельных запросов', async () => {
    let resolveOAuth: ((response: Response) => void) | undefined;
    const oauthResponse = new Promise<Response>((resolve) => { resolveOAuth = resolve; });
    const fetchMock = vi.fn<typeof fetch>((url) => {
      if (String(url) === config.authUrl) return oauthResponse;
      return Promise.resolve(jsonResponse({
        choices: [{ message: { content: '{"decision":"allow"}' } }],
      }));
    });
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    const first = moderator.moderate('Первая задача');
    const second = moderator.moderate('Вторая задача');
    resolveOAuth?.(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }));

    await expect(first).resolves.toEqual({ decision: 'allow' });
    await expect(second).resolves.toEqual({ decision: 'allow' });
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === config.authUrl)).toHaveLength(1);
  });
});
