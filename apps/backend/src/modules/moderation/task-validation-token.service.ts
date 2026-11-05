import { createHmac, timingSafeEqual } from 'node:crypto';

import { normalizeTaskText } from './task-validation.js';

const TOKEN_VERSION = 'v1';

export interface TaskValidationTokenConfig {
  secret: string;
  ttlMs: number;
}

export class TaskValidationTokenService {
  constructor(
    private readonly config: TaskValidationTokenConfig,
    private readonly now: () => number = Date.now
  ) {}

  issue(text: string): string {
    const expiresAt = this.now() + this.config.ttlMs;
    const payload = `${TOKEN_VERSION}.${expiresAt}.${hashText(normalizeTaskText(text))}`;
    return `${payload}.${this.sign(payload)}`;
  }

  verify(text: string, token: string | undefined): boolean {
    if (!token) return false;
    const parts = token.split('.');
    if (parts.length !== 4) return false;
    const [version, expiresAtRaw, textHash, signature] = parts;
    if (version !== TOKEN_VERSION || !expiresAtRaw || !textHash || !signature) return false;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= this.now()) return false;
    if (!safeEqual(textHash, hashText(normalizeTaskText(text)))) return false;
    return safeEqual(signature, this.sign(`${version}.${expiresAtRaw}.${textHash}`));
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.config.secret).update(payload).digest('base64url');
  }
}

function hashText(text: string): string {
  return createHmac('sha256', 'task-validation').update(text).digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
