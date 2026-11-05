import { env } from '@/lib/config/env.js';
import { BadRequestException, ServiceUnavailableException } from '@/lib/http/errors.js';
import { logger } from '@/lib/logger.js';

import { GigaChatTaskModerator } from './gigachat-task.moderator.js';
import { ModerationUnavailableError } from './moderation.errors.js';
import { TaskValidationTokenService } from './task-validation-token.service.js';
import { normalizeTaskText, requireValidatedTaskText } from './task-validation.js';

const log = logger.child({ module: 'moderation' });

const moderator = new GigaChatTaskModerator({
  authorizationKey: env.GIGACHAT_AUTHORIZATION_KEY,
  scope: env.GIGACHAT_SCOPE,
  authUrl: env.GIGACHAT_AUTH_URL,
  apiUrl: env.GIGACHAT_API_URL,
  model: env.GIGACHAT_MODEL,
  timeoutMs: env.GIGACHAT_TIMEOUT_MS,
  maxTaskLength: env.FREEFORM_TASK_MAX_LENGTH,
});

const validationTokens = new TaskValidationTokenService({
  secret: env.TASK_VALIDATION_SECRET,
  ttlMs: env.TASK_VALIDATION_TTL_MS,
});

export const moderationService = {
  checkHealth(): Promise<boolean> {
    return moderator.checkHealth();
  },

  async validate(text: string, signal?: AbortSignal): Promise<{ allowed: true; validationToken: string }> {
    const normalized = normalizeTaskText(text);
    try {
      const verdict = await moderator.moderate(normalized, signal);
      if (verdict.decision === 'reject') {
        log.info({ reason: verdict.reason }, 'task rejected by moderation');
        throw new BadRequestException('Задача не прошла проверку.', 'TASK_MODERATION_REJECTED');
      }
      return { allowed: true, validationToken: validationTokens.issue(normalized) };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof ModerationUnavailableError) {
        log.warn({
          moderationError: error.name,
          stage: error.diagnostic.stage,
          status: error.diagnostic.status,
          reason: error.diagnostic.reason,
        }, 'moderation unavailable');
        throw new ServiceUnavailableException(
          'Проверка задачи временно недоступна.',
          'MODERATION_UNAVAILABLE'
        );
      }
      throw error;
    }
  },

  requireValidated(text: string, validationToken: string | undefined): string {
    return requireValidatedTaskText(text, validationToken, validationTokens);
  },
};
