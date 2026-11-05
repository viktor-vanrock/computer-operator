import { BadGatewayException, NotFoundException } from '@/lib/http/errors.js';
import { logger } from '@/lib/logger.js';
import { withRetry } from '@/lib/resilience/retry.js';

import { GUAC_DEFAULTS } from './guacamole.constants.js';

const log = logger.child({ module: 'guacamole-client' });
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

class GuacamoleHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function isTransient(error: unknown): boolean {
  return error instanceof GuacamoleHttpError && RETRYABLE_STATUS_CODES.has(error.status)
    || error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
    || error instanceof TypeError;
}

// ─── Типы ответов Guacamole API ───────────────────────────────────────────────

interface AuthTokenResponse {
  authToken: string;
}

interface SharingProfileResponse {
  identifier: string;
}

interface ActiveConnectionEntry {
  identifier: string;
  connectionIdentifier: string;
}

interface SharingKeyResponse {
  values: {
    key: string;
  };
}

// ─── Публичные типы ───────────────────────────────────────────────────────────

export interface GuacSharingParams {
  connectionId: string;
  datasource: string;
  guacToken: string;
  sharingProfileId: string;
  tunnelId: string;
}

// ─── Клиент ───────────────────────────────────────────────────────────────────

export class GuacamoleClient {
  private readonly baseUrl: string;
  private readonly adminUsername: string;
  private readonly adminPassword: string;

  constructor(baseUrl: string, adminUsername: string, adminPassword: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.adminUsername = adminUsername;
    this.adminPassword = adminPassword;
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.getAuthToken(false);
      return true;
    } catch {
      return false;
    }
  }

  async getAuthToken(logRequest = true): Promise<string> {
    if (logRequest) log.debug({ url: this.baseUrl }, 'getAuthToken: POST /api/tokens');
    return withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/api/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          username: this.adminUsername,
          password: this.adminPassword,
        }).toString(),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const message = `Ошибка получения токена: ${res.status} ${res.statusText}`;
        if (RETRYABLE_STATUS_CODES.has(res.status)) throw new GuacamoleHttpError(res.status, message);
        throw new BadGatewayException(message);
      }
      const data = (await res.json()) as AuthTokenResponse;
      return data.authToken;
    }, {
      shouldRetry: isTransient,
      onRetry: (error, attempt) => log.warn({ error, attempt }, 'getAuthToken: transient failure, retrying'),
    });
  }

  buildConnectArgs(authToken: string, guacId: string, { dpi = GUAC_DEFAULTS.DPI }: { dpi?: number } = {}): string {
    const params = new URLSearchParams();
    params.append('token', authToken);
    params.append('GUAC_DATA_SOURCE', GUAC_DEFAULTS.DATA_SOURCE);
    params.append('GUAC_ID', guacId);
    params.append('GUAC_TYPE', GUAC_DEFAULTS.TYPE);
    params.append('GUAC_WIDTH', String(GUAC_DEFAULTS.WIDTH));
    params.append('GUAC_HEIGHT', String(GUAC_DEFAULTS.HEIGHT));
    params.append('GUAC_DPI', String(dpi));
    params.append('GUAC_TIMEZONE', GUAC_DEFAULTS.TIMEZONE);
    for (const audio of GUAC_DEFAULTS.AUDIO) {
      params.append('GUAC_AUDIO', audio);
    }
    for (const image of GUAC_DEFAULTS.IMAGE) {
      params.append('GUAC_IMAGE', image);
    }
    return params.toString();
  }

  async createSharingProfile(authToken: string, guacId: string): Promise<string> {
    log.debug({ guacId }, 'createSharingProfile: POST /sharingProfiles');
    const name = `share-${guacId}-${Date.now()}`;
    const res = await fetch(
      `${this.baseUrl}/api/session/data/${GUAC_DEFAULTS.DATA_SOURCE}/sharingProfiles`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Guacamole-Token': authToken,
        },
        body: JSON.stringify({
          primaryConnectionIdentifier: guacId,
          name,
          parameters: { 'read-only': 'false' },
          attributes: {},
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!res.ok) {
      throw new BadGatewayException(`Ошибка создания профиля: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as SharingProfileResponse;
    return data.identifier;
  }

  /**
   * Fallback-путь: используется только если фронтенд не передал tunnelId
   * (полученный напрямую от клиентского Guacamole-туннеля — см. buildSharingParamsWithTunnel).
   * Опрос /activeConnections подвержен race condition: клиентский туннель может
   * перейти в OPEN раньше, чем guacd зарегистрирует соединение здесь.
   */
  async getActiveTunnelId(authToken: string, guacId: string): Promise<string> {
    log.debug({ guacId }, 'getActiveTunnelId: GET /activeConnections');
    const res = await fetch(
      `${this.baseUrl}/api/session/data/${GUAC_DEFAULTS.DATA_SOURCE}/activeConnections`,
      {
        headers: { 'Guacamole-Token': authToken },
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!res.ok) {
      throw new BadGatewayException(`Ошибка получения активных подключений: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as Record<string, ActiveConnectionEntry>;

    const entry = Object.values(data).find((e) => String(e.connectionIdentifier) === String(guacId));
    if (!entry) {
      throw new NotFoundException(`Активное подключение не найдено для guacId=${guacId}`);
    }
    log.debug({ guacId, tunnelId: entry.identifier }, 'getActiveTunnelId: found tunnel');
    return entry.identifier;
  }

  async getSharingKey(authToken: string, tunnelId: string, sharingProfileId: string): Promise<string> {
    const url = `${this.baseUrl}/api/session/tunnels/${tunnelId}/activeConnection/sharingCredentials/${sharingProfileId}`;
    log.debug({ tunnelId, sharingProfileId, url }, 'getSharingKey: GET /sharingCredentials');
    const res = await fetch(
      `${this.baseUrl}/api/session/tunnels/${tunnelId}/activeConnection/sharingCredentials/${sharingProfileId}`,
      {
        headers: { 'Guacamole-Token': authToken },
        signal: AbortSignal.timeout(30000),
      }
    );
    if (!res.ok) {
      throw new BadGatewayException(`Ошибка получения ключа совместного доступа: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as SharingKeyResponse;
    return data.values.key;
  }

  async getSharingToken(sharingKey: string): Promise<string> {
    log.debug('getSharingToken: POST /api/tokens with sharingKey');
    const res = await fetch(`${this.baseUrl}/api/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ key: sharingKey }).toString(),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new BadGatewayException(`Ошибка получения токена совместного доступа: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as AuthTokenResponse;
    return data.authToken;
  }

  /**
   * Периодически делает лёгкий GET-запрос к Guacamole, продлевая TTL токена.
   * Guacamole сбрасывает таймер сессии при любом API-вызове.
   * Без этого токен протухает через ~60 мин и getSharingKey в startNextTask падает с 401.
   */
  startHeartbeat(authToken: string, intervalMs = 30 * 60 * 1000): () => void {
    const timer = setInterval(async () => {
      try {
        await fetch(
          `${this.baseUrl}/api/session/data/${GUAC_DEFAULTS.DATA_SOURCE}/connections`,
          { headers: { 'Guacamole-Token': authToken }, signal: AbortSignal.timeout(30000) }
        );
        log.debug({ url: this.baseUrl }, 'guacamole token heartbeat: ok');
      } catch (err) {
        log.warn({ err, url: this.baseUrl }, 'guacamole token heartbeat: failed');
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }

  async buildSharingParams(authToken: string, guacId: string): Promise<GuacSharingParams> {
    const sharingProfileId = await this.createSharingProfile(authToken, guacId);
    const tunnelId = await this.getActiveTunnelId(authToken, guacId);
    const sharingKey = await this.getSharingKey(authToken, tunnelId, sharingProfileId);
    const guacToken = await this.getSharingToken(sharingKey);
    return {
      connectionId: sharingKey,
      datasource: GUAC_DEFAULTS.SHARING_DATA_SOURCE,
      guacToken,
      sharingProfileId,
      tunnelId,
    };
  }

  /**
   * tunnelId уже известен (получен на фронтенде напрямую от клиентского
   * Guacamole-туннеля через tunnel.uuid) — не нужно опрашивать /activeConnections
   * и гадать, зарегистрировал ли guacd соединение. Устраняет race condition,
   * актуальную в buildSharingParams при параллельных подключениях туннелей.
   */
  async buildSharingParamsWithTunnel(authToken: string, guacId: string, tunnelId: string): Promise<GuacSharingParams> {
    const sharingProfileId = await this.createSharingProfile(authToken, guacId);
    const sharingKey = await this.getSharingKey(authToken, tunnelId, sharingProfileId);
    const guacToken = await this.getSharingToken(sharingKey);
    return {
      connectionId: sharingKey,
      datasource: GUAC_DEFAULTS.SHARING_DATA_SOURCE,
      guacToken,
      sharingProfileId,
      tunnelId,
    };
  }

  /**
   * Используется в startNextTask: создаёт sharing profile свежим токеном,
   * но получает ключ через оригинальный токен + сохранённый tunnelId.
   * Это нужно потому что /api/session/tunnels/ — session-scoped endpoint:
   * getSharingKey работает только с токеном, который владеет туннелем.
   */
  async buildSharingParamsWithSavedTunnel(
    freshToken: string,
    originalToken: string,
    guacId: string,
    savedTunnelId: string
  ): Promise<GuacSharingParams> {
    const sharingProfileId = await this.createSharingProfile(freshToken, guacId);
    const sharingKey = await this.getSharingKey(originalToken, savedTunnelId, sharingProfileId);
    const guacToken = await this.getSharingToken(sharingKey);
    return {
      connectionId: sharingKey,
      datasource: GUAC_DEFAULTS.SHARING_DATA_SOURCE,
      guacToken,
      sharingProfileId,
      tunnelId: savedTunnelId,
    };
  }
}
