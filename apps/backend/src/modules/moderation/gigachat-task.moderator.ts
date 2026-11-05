import { randomUUID } from 'node:crypto';

import {
  MAX_RETRY_DELAY_MS,
  MODERATION_JSON_SCHEMA,
  MODERATION_SYSTEM_PROMPT,
  RETRY_DELAY_MS,
  TOKEN_EXPIRY_SAFETY_MS,
} from './moderation.constants.js';
import { ModerationUnavailableError } from './moderation.errors.js';
import {
  ChatResponseSchema,
  OAuthErrorSchema,
  ProviderVerdictSchema,
  TokenResponseSchema,
  VerdictSchema,
} from './moderation.schema.js';

import type { ModerationResult, TaskModerator } from './moderation.types.js';

export interface GigaChatConfig {
  authorizationKey: string;
  scope: string;
  authUrl: string;
  apiUrl: string;
  model: string;
  timeoutMs: number;
  maxTaskLength: number;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export class GigaChatTaskModerator implements TaskModerator {
  private token: CachedToken | undefined;
  private tokenRefresh: Promise<string> | undefined;

  constructor(
    private readonly config: GigaChatConfig,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  async checkHealth(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  async moderate(text: string, signal?: AbortSignal): Promise<ModerationResult> {
    if (text.length > this.config.maxTaskLength) {
      return { decision: 'reject', reason: 'task_too_long' };
    }
    let accessToken = await this.getAccessToken(signal);
    let response = await this.sendChat(text, accessToken, signal);
    if (response.status === 401) {
      this.token = undefined;
      accessToken = await this.getAccessToken(signal);
      response = await this.sendChat(text, accessToken, signal);
    }
    if (!response.ok) {
      throw new ModerationUnavailableError('GigaChat moderation request failed.', {
        stage: 'chat', status: response.status,
      });
    }

    const envelope = await this.parseJson(response, ChatResponseSchema, 'chat_envelope');
    const choice = envelope.choices[0];
    if (choice?.finish_reason === 'blacklist') {
      return { decision: 'reject', reason: 'provider_blacklist' };
    }

    const content = choice?.message.content ?? '';
    const bareDecision = extractBareDecision(content);
    if (bareDecision === 'allow') return { decision: 'allow' };
    if (bareDecision === 'reject') return { decision: 'reject', reason: 'provider_reject' };

    let verdictJson: unknown;
    try {
      verdictJson = JSON.parse(extractJson(content));
    } catch (error) {
      throw new ModerationUnavailableError('GigaChat moderation verdict is not JSON.', {
        stage: 'response', reason: 'verdict_json',
      }, error);
    }
    const verdict = VerdictSchema.safeParse(verdictJson);
    if (!verdict.success) {
      const providerVerdict = ProviderVerdictSchema.safeParse(verdictJson);
      if (providerVerdict.success && providerVerdict.data.decision === 'reject') {
        return { decision: 'reject', reason: 'provider_reject' };
      }
      throw new ModerationUnavailableError('GigaChat moderation verdict has an invalid shape.', {
        stage: 'response', reason: 'verdict_schema',
      }, verdict.error);
    }
    return verdict.data;
  }

  private sendChat(text: string, accessToken: string, signal?: AbortSignal): Promise<Response> {
    return this.sendWithRetry(`${this.config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages: [
          { role: 'system', content: MODERATION_SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
        temperature: 0,
        max_tokens: 80,
        response_format: { type: 'json_schema', schema: MODERATION_JSON_SCHEMA, strict: true },
      }),
    }, signal);
  }

  private getAccessToken(signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt - TOKEN_EXPIRY_SAFETY_MS > Date.now()) {
      return Promise.resolve(this.token.value);
    }
    if (!this.tokenRefresh) {
      this.tokenRefresh = this.refreshAccessToken(signal).finally(() => { this.tokenRefresh = undefined; });
    }
    return this.tokenRefresh;
  }

  private async refreshAccessToken(signal?: AbortSignal): Promise<string> {
    const response = await this.sendWithRetry(this.config.authUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.config.authorizationKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: randomUUID(),
      },
      body: new URLSearchParams({ scope: this.config.scope }),
    }, signal);
    if (!response.ok) {
      const providerError = await readOAuthError(response);
      throw new ModerationUnavailableError('GigaChat authorization failed.', {
        stage: 'oauth',
        status: response.status,
        ...(providerError ? { reason: providerError } : {}),
      });
    }
    const parsed = await this.parseJson(response, TokenResponseSchema, 'oauth_response');
    this.token = { value: parsed.access_token, expiresAt: parsed.expires_at };
    return parsed.access_token;
  }

  private async send(url: string, init: RequestInit, parentSignal?: AbortSignal): Promise<Response> {
    const timeoutSignal = AbortSignal.timeout(this.config.timeoutMs);
    const signal = parentSignal ? AbortSignal.any([parentSignal, timeoutSignal]) : timeoutSignal;
    try {
      return await this.fetcher(url, { ...init, signal });
    } catch (error) {
      const stage = timeoutSignal.aborted ? 'timeout' : 'transport';
      const reason = transportErrorCode(error);
      throw new ModerationUnavailableError(
        'GigaChat request failed.',
        { stage, ...(reason ? { reason } : {}) },
        error
      );
    }
  }

  private async sendWithRetry(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    try {
      const first = await this.send(url, init, signal);
      if (!isRetryableStatus(first.status)) return first;
      await waitForRetry(first, signal);
    } catch (error) {
      if (!(error instanceof ModerationUnavailableError)) throw error;
      await delay(RETRY_DELAY_MS, signal);
    }
    return this.send(url, init, signal);
  }

  private async parseJson<T>(
    response: Response,
    schema: {
      safeParse: (value: unknown) =>
        { success: true; data: T } | { success: false; error: unknown };
    },
    reason: string
  ): Promise<T> {
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ModerationUnavailableError('GigaChat returned malformed JSON.', {
        stage: 'response', status: response.status, reason,
      }, error);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ModerationUnavailableError('GigaChat response has an invalid shape.', {
        stage: 'response', status: response.status, reason,
      }, parsed.error);
    }
    return parsed.data;
  }
}

async function readOAuthError(response: Response): Promise<string | undefined> {
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return undefined;
  }
  const parsed = OAuthErrorSchema.safeParse(json);
  if (!parsed.success) return undefined;
  if (parsed.data.code !== undefined) return `provider_code_${String(parsed.data.code)}`;
  return parsed.data.error ? `provider_error_${sanitizeDiagnostic(parsed.data.error)}` : undefined;
}

function sanitizeDiagnostic(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
}

function transportErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !('cause' in error)) return undefined;
  const cause = error.cause;
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return undefined;
  return typeof cause.code === 'string' ? cause.code : undefined;
}

function extractJson(content: string): string {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)?.[1]?.trim();
  if (fenced?.startsWith('{') && fenced.endsWith('}')) return fenced;
  throw new Error('Unsupported verdict format.');
}

function extractBareDecision(content: string): 'allow' | 'reject' | undefined {
  let normalized = content.trim().toLowerCase();
  const fenced = /^```(?:[a-z]+)?\s*\n?([\s\S]*?)\n?```$/i.exec(normalized);
  if (fenced?.[1]) normalized = fenced[1].trim();
  const emphasized = /^(?:\*\*|__|`)(allow|reject)(?:\*\*|__|`)$/i.exec(normalized);
  if (emphasized?.[1]) normalized = emphasized[1].toLowerCase();
  return normalized === 'allow' || normalized === 'reject' ? normalized : undefined;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function waitForRetry(response: Response, signal?: AbortSignal): Promise<void> {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const delayMs = Number.isFinite(seconds)
    ? Math.min(Math.max(seconds * 1_000, 0), MAX_RETRY_DELAY_MS)
    : RETRY_DELAY_MS;
  await delay(delayMs, signal);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Request aborted.'));
      return;
    }
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('Request aborted.'));
    };
    function finish() {
      signal?.removeEventListener('abort', abort);
      resolve();
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
