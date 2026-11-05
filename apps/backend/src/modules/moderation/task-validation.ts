import { BadRequestException } from '@/lib/http/errors.js';

import type { TaskValidationTokenService } from './task-validation-token.service.js';

export function normalizeTaskText(text: string): string {
  return text.trim();
}

export function requireValidatedTaskText(
  text: string,
  validationToken: string | undefined,
  tokens: TaskValidationTokenService
): string {
  const normalized = normalizeTaskText(text);
  if (!tokens.verify(normalized, validationToken)) {
    throw new BadRequestException('Сначала подтвердите задачу.', 'TASK_VALIDATION_REQUIRED');
  }
  return normalized;
}
