import { describe, expect, it } from 'vitest';

import { ALLOWED_EVERYDAY_TASK_EXAMPLES } from '@/modules/moderation/moderation-examples.js';
import { MODERATION_SYSTEM_PROMPT } from '@/modules/moderation/moderation.constants.js';

describe('moderation policy examples', () => {
  it('включает повседневные сценарии демостенда в системный промпт', () => {
    expect(ALLOWED_EVERYDAY_TASK_EXAMPLES).toEqual(expect.arrayContaining([
      expect.stringContaining('напоминание'),
      expect.stringContaining('тренировку'),
      expect.stringContaining('доставку'),
      expect.stringContaining('показания счётчиков'),
      expect.stringContaining('гарантийное обращение'),
      expect.stringContaining('умный дом'),
    ]));

    for (const example of ALLOWED_EVERYDAY_TASK_EXAMPLES) {
      expect(MODERATION_SYSTEM_PROMPT).toContain(example);
    }
  });
});
