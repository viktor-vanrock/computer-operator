import { describe, expect, it, vi } from 'vitest';

import { GigaChatTaskModerator } from '@/modules/moderation/gigachat-task.moderator.js';
import { ModerationUnavailableError } from '@/modules/moderation/moderation.errors.js';

const config = {
  authorizationKey: 'secret',
  scope: 'GIGACHAT_API_PERS',
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

describe('GigaChatTaskModerator', () => {
  it('возвращает allow после OAuth и строгого verdict', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"decision":"allow"}' } }] }));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.moderate('Открой браузер')).resolves.toEqual({ decision: 'allow' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('передаёт классификатору примеры допустимых коротких команд', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"decision":"allow"}' } }] }));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await moderator.moderate('закрой браузер');

    const chatRequest = fetchMock.mock.calls[1]?.[1];
    const body = JSON.parse(String(chatRequest?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]?.content).toContain('«закрой браузер»');
    expect(body.messages[0]?.content).toContain('Короткая команда не является расплывчатой');
  });

  it('явно разрешает обычные записи и бронирования по запросу пользователя', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"decision":"allow"}' } }] }));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await moderator.moderate('Запиши меня на тренировку для начинающих после 19:00');

    const chatRequest = fetchMock.mock.calls[1]?.[1];
    const body = JSON.parse(String(chatRequest?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages[0]?.content).toContain('запиши меня на тренировку');
    expect(body.messages[0]?.content).toContain('Запрос пользователя выполнить действие от его имени');
  });

  it('не вызывает GigaChat для слишком длинной задачи', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const moderator = new GigaChatTaskModerator({ ...config, maxTaskLength: 3 }, fetchMock);

    await expect(moderator.moderate('1234')).resolves.toEqual({ decision: 'reject', reason: 'task_too_long' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('трактует blacklist как содержательное отклонение', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ finish_reason: 'blacklist', message: { content: 'blocked' } }] }));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.moderate('Опасный текст')).resolves.toEqual({ decision: 'reject', reason: 'provider_blacklist' });
  });

  it('трактует неизвестную формулировку причины как содержательное отклонение', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{
          message: {
            content: '{"decision":"reject","reason":"illegal activity or unauthorized access"}',
          },
        }],
      }));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.moderate('Опасный текст')).resolves.toEqual({
      decision: 'reject',
      reason: 'provider_reject',
    });
  });

  it.each([
    'reject',
    '```text\nreject\n```',
    '```\nreject\n```',
    '**reject**',
    '`reject`',
  ])(
    'трактует ответ провайдера %j как содержательное отклонение',
    async (content) => {
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }))
        .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content } }] }));
      const moderator = new GigaChatTaskModerator(config, fetchMock);

      await expect(moderator.moderate('Опасный текст')).resolves.toEqual({
        decision: 'reject',
        reason: 'provider_reject',
      });
    }
  );

  it('преобразует некорректный ответ провайдера в инфраструктурную ошибку', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [] }));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.moderate('Открой браузер')).rejects.toBeInstanceOf(ModerationUnavailableError);
  });

  it('обновляет access token и один раз повторяет chat-запрос после 401', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'first', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'second', expires_at: Date.now() + 60_000 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"decision":"allow"}' } }] }));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.moderate('Открой браузер')).resolves.toEqual({ decision: 'allow' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('сохраняет безопасный TLS-код в диагностике транспортной ошибки', async () => {
    const tlsError = Object.assign(new Error('certificate rejected'), {
      code: 'SELF_SIGNED_CERT_IN_CHAIN',
    });
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(
      new TypeError('fetch failed', { cause: tlsError })
    );
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.moderate('Открой браузер')).rejects.toMatchObject({
      diagnostic: {
        stage: 'transport',
        reason: 'SELF_SIGNED_CERT_IN_CHAIN',
      },
    });
  });

  it('сохраняет безопасный код OAuth-провайдера в диагностике', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ code: 7 }, 400));
    const moderator = new GigaChatTaskModerator(config, fetchMock);

    await expect(moderator.moderate('Открой браузер')).rejects.toMatchObject({
      diagnostic: {
        stage: 'oauth',
        status: 400,
        reason: 'provider_code_7',
      },
    });
  });
});
