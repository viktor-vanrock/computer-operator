import type { AdminTask } from '@arena/ui/types/task.types';
import { describe, expect, it } from 'vitest';

import { serializePresetExport } from '@/features/task-management/task-export';
import { parsePresetImport } from '@/features/task-management/task-import';

const tasks: AdminTask[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440000',
    title: 'Видимый пресет',
    prompt: 'Выполните видимое задание',
    imageId: null,
    difficulty: 2,
    isPreset: true,
    isVisible: true,
    createdAt: '2026-09-08T00:00:00.000Z',
  },
  {
    id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    title: 'Скрытый пресет',
    prompt: 'Выполните скрытое задание',
    imageId: 'image-42',
    difficulty: 5,
    isPreset: true,
    isVisible: false,
    createdAt: '2026-09-08T00:00:00.000Z',
  },
];

describe('serializePresetExport', () => {
  it('экспортирует все пресеты без служебных полей', () => {
    const parsed = JSON.parse(serializePresetExport(tasks)) as { tasks: Record<string, unknown>[] };

    expect(parsed.tasks).toHaveLength(2);
    expect(parsed.tasks[1]).toEqual({
      title: 'Скрытый пресет',
      prompt: 'Выполните скрытое задание',
      imageId: 'image-42',
      difficulty: 5,
      isVisible: false,
    });
    expect(parsed.tasks[0]).not.toHaveProperty('id');
    expect(parsed.tasks[0]).not.toHaveProperty('createdAt');
    expect(parsed.tasks[0]).not.toHaveProperty('isPreset');
  });

  it('формирует JSON, совместимый с импортом', () => {
    expect(parsePresetImport(serializePresetExport(tasks))).toEqual([
      {
        title: 'Видимый пресет', prompt: 'Выполните видимое задание', imageId: null, difficulty: 2, isVisible: true,
      },
      {
        title: 'Скрытый пресет', prompt: 'Выполните скрытое задание', imageId: 'image-42', difficulty: 5, isVisible: false,
      },
    ]);
  });
});
