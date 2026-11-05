import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/config/env.js', () => ({
  env: {
    AGENT_MANAGER_API_URL: 'http://localhost:4000',
    PORT: 3001,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test',
    LOG_LEVEL: 'error',
    METRICS_TOKEN: undefined,
    GUACAMOLE_URL: 'http://guac',
    GUACAMOLE_ADMIN_USERNAME: 'admin',
    GUACAMOLE_ADMIN_PASSWORD: 'pass',
  },
  isDev: false,
}));

vi.mock('@/lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));


import { GuacamoleClient } from '@/lib/guacamole/guacamole.client.js';
import { GUAC_DEFAULTS } from '@/lib/guacamole/guacamole.constants.js';

const BASE_URL = 'https://guac.example.com';
const ADMIN = 'admin';
const PASS = 'secret';

function makeClient() {
  return new GuacamoleClient(BASE_URL, ADMIN, PASS);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function okResponse(data: unknown) {
  return Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));
}

describe('GuacamoleClient.getAuthToken', () => {
  it('отправляет POST /api/tokens и возвращает authToken', async () => {
    fetchMock.mockResolvedValue(okResponse({ authToken: 'tok123' }));
    const client = makeClient();
    const token = await client.getAuthToken();
    expect(token).toBe('tok123');
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/tokens`,
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('бросает ошибку при non-2xx ответе', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }));
    const client = makeClient();
    await expect(client.getAuthToken()).rejects.toThrow('Ошибка получения токена: 401');
  });
});

describe('GuacamoleClient.buildConnectArgs', () => {
  it('передает DPI 144 без изменения разрешения и сохраняет DPI 96 по умолчанию', () => {
    const client = makeClient();
    const params = new URLSearchParams(client.buildConnectArgs('token', 'connection', { dpi: 144 }));
    expect(params.get('GUAC_DPI')).toBe('144');
    expect(params.get('GUAC_WIDTH')).toBe('1920');
    expect(params.get('GUAC_HEIGHT')).toBe('1080');
    expect(new URLSearchParams(client.buildConnectArgs('token', 'connection')).get('GUAC_DPI')).toBe('96');
  });

  it('строит строку с правильными полями', () => {
    const client = makeClient();
    const args = client.buildConnectArgs('TOKEN_ABC', 'GUAC_ID_999');
    const params = new URLSearchParams(args);

    expect(params.get('token')).toBe('TOKEN_ABC');
    expect(params.get('GUAC_DATA_SOURCE')).toBe(GUAC_DEFAULTS.DATA_SOURCE);
    expect(params.get('GUAC_ID')).toBe('GUAC_ID_999');
    expect(params.get('GUAC_TYPE')).toBe(GUAC_DEFAULTS.TYPE);
    expect(params.get('GUAC_WIDTH')).toBe(String(GUAC_DEFAULTS.WIDTH));
    expect(params.get('GUAC_HEIGHT')).toBe(String(GUAC_DEFAULTS.HEIGHT));
    expect(params.get('GUAC_DPI')).toBe(String(GUAC_DEFAULTS.DPI));
    expect(params.get('GUAC_TIMEZONE')).toBe(GUAC_DEFAULTS.TIMEZONE);
    expect(params.getAll('GUAC_AUDIO')).toEqual(GUAC_DEFAULTS.AUDIO);
    expect(params.getAll('GUAC_IMAGE')).toEqual(GUAC_DEFAULTS.IMAGE);
  });
});

describe('GuacamoleClient.createSharingProfile', () => {
  it('POST sharingProfiles и возвращает identifier', async () => {
    fetchMock.mockResolvedValue(okResponse({ identifier: '42' }));
    const client = makeClient();
    const id = await client.createSharingProfile('tok', '9904');
    expect(id).toBe('42');
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/session/data/${GUAC_DEFAULTS.DATA_SOURCE}/sharingProfiles`,
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'Guacamole-Token': 'tok' }) })
    );
  });

  it('бросает ошибку при non-2xx ответе', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const client = makeClient();
    await expect(client.createSharingProfile('tok', 'id')).rejects.toThrow('Ошибка создания профиля: 500');
  });
});

describe('GuacamoleClient.getActiveTunnelId', () => {
  it('находит tunnelId по connectionIdentifier', async () => {
    fetchMock.mockResolvedValue(okResponse({
      'uuid-abc': { identifier: 'uuid-abc', connectionIdentifier: '9904' },
      'uuid-xyz': { identifier: 'uuid-xyz', connectionIdentifier: '1234' },
    }));
    const client = makeClient();
    const tunnelId = await client.getActiveTunnelId('tok', '9904');
    expect(tunnelId).toBe('uuid-abc');
  });

  it('бросает ошибку если guacId не найден в активных соединениях', async () => {
    fetchMock.mockImplementation(() => okResponse({}));
    const client = makeClient();
    await expect(client.getActiveTunnelId('tok', '9999')).rejects.toThrow('Активное подключение не найдено для guacId=9999');
  });
});

describe('GuacamoleClient.getSharingKey', () => {
  it('возвращает key из values', async () => {
    fetchMock.mockResolvedValue(okResponse({ values: { key: 'a1b2c3d4' } }));
    const client = makeClient();
    const key = await client.getSharingKey('tok', 'tunnel-1', 'profile-1');
    expect(key).toBe('a1b2c3d4');
  });
});

describe('GuacamoleClient.getSharingToken', () => {
  it('POST /api/tokens с key и возвращает authToken', async () => {
    fetchMock.mockResolvedValue(okResponse({ authToken: 'sharing-tok' }));
    const client = makeClient();
    const tok = await client.getSharingToken('a1b2c3d4');
    expect(tok).toBe('sharing-tok');
    const calls = fetchMock.mock.calls;
    const lastCall = calls[calls.length - 1];
    expect((lastCall![1] as RequestInit).body).toContain('a1b2c3d4');
  });
});

describe('GuacamoleClient.buildSharingParams', () => {
  it('выполняет полную цепочку и возвращает все поля', async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ identifier: '42' }))          // createSharingProfile
      .mockResolvedValueOnce(okResponse({                                  // getActiveTunnelId
        'tunnel-uuid': { identifier: 'tunnel-uuid', connectionIdentifier: 'guac-1' },
      }))
      .mockResolvedValueOnce(okResponse({ values: { key: 'sharing-key-xyz' } })) // getSharingKey
      .mockResolvedValueOnce(okResponse({ authToken: 'guac-sharing-token' }));   // getSharingToken

    const client = makeClient();
    const result = await client.buildSharingParams('admin-tok', 'guac-1');

    expect(result.sharingProfileId).toBe('42');
    expect(result.connectionId).toBe('sharing-key-xyz');
    expect(result.datasource).toBe(GUAC_DEFAULTS.SHARING_DATA_SOURCE);
    expect(result.guacToken).toBe('guac-sharing-token');
  });

  it('пробрасывает ошибку любого шага цепочки', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }));
    const client = makeClient();
    await expect(client.buildSharingParams('tok', 'guac-1')).rejects.toThrow();
  });
});

describe('GuacamoleClient.checkHealth', () => {
  it('не бросает исключение при ошибке (только warn)', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    const client = makeClient();
    await expect(client.checkHealth()).resolves.not.toThrow();
  });

  it('не бросает исключение при успехе', async () => {
    fetchMock.mockResolvedValue(okResponse({ authToken: 'tok' }));
    const client = makeClient();
    await expect(client.checkHealth()).resolves.not.toThrow();
  });
});
