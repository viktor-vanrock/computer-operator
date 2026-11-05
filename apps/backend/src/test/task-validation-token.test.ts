import { describe, expect, it } from 'vitest';

import { TaskValidationTokenService } from '@/modules/moderation/task-validation-token.service.js';

describe('TaskValidationTokenService', () => {
  it('принимает токен только для исходного нормализованного текста до истечения TTL', () => {
    let now = 1_000;
    const service = new TaskValidationTokenService(
      { secret: '0123456789abcdef0123456789abcdef', ttlMs: 2_000 },
      () => now
    );

    const token = service.issue('  Открой браузер  ');

    expect(service.verify('Открой браузер', token)).toBe(true);
    expect(service.verify('Открой другой браузер', token)).toBe(false);
    now = 3_001;
    expect(service.verify('Открой браузер', token)).toBe(false);
  });

  it('отклоняет отсутствующий и повреждённый токен', () => {
    const service = new TaskValidationTokenService({
      secret: '0123456789abcdef0123456789abcdef',
      ttlMs: 2_000,
    });
    const token = service.issue('Открой браузер');

    expect(service.verify('Открой браузер', undefined)).toBe(false);
    expect(service.verify('Открой браузер', `${token}x`)).toBe(false);
  });
});
