import { describe, expect, it } from 'vitest';

import { TaskValidationTokenService } from '@/modules/moderation/task-validation-token.service.js';
import { requireValidatedTaskText } from '@/modules/moderation/task-validation.js';

const tokens = new TaskValidationTokenService({
  secret: '0123456789abcdef0123456789abcdef',
  ttlMs: 2_000,
});

describe('requireValidatedTaskText', () => {
  it('возвращает тот же нормализованный текст, который был подтверждён', () => {
    const token = tokens.issue('  Открой браузер  ');

    expect(requireValidatedTaskText(' Открой браузер ', token, tokens)).toBe('Открой браузер');
  });

  it('возвращает публичную доменную ошибку при подмене текста', () => {
    const token = tokens.issue('Открой браузер');

    expect(() => requireValidatedTaskText('Открой терминал', token, tokens)).toThrow(
      expect.objectContaining({
        statusCode: 400,
        code: 'TASK_VALIDATION_REQUIRED',
        message: 'Сначала подтвердите задачу.',
      })
    );
  });
});
