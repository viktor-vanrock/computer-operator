import { describe, expect, it } from 'vitest';

import { parsePresetImport } from '@/features/task-management/task-import';

describe('parsePresetImport', () => {
  it('принимает объект шаблона и выставляет isVisible по умолчанию', () => {
    expect(parsePresetImport(JSON.stringify({ tasks: [{
      title: 'Задача', prompt: 'Инструкция агенту', difficulty: 2,
    }] }))).toEqual([{
      title: 'Задача', prompt: 'Инструкция агенту', imageId: null, difficulty: 2, isVisible: true,
    }]);
  });

  it('принимает массив задач', () => {
    expect(parsePresetImport(JSON.stringify([{
      title: 'Скрытая', prompt: 'Промпт', difficulty: 5, isVisible: false,
    }]))[0]?.isVisible).toBe(false);
  });

  it('сохраняет указанный imageId', () => {
    expect(parsePresetImport(JSON.stringify([{
      title: 'Образ', prompt: 'Промпт', imageId: 'image-42', difficulty: 3,
    }]))[0]?.imageId).toBe('image-42');
  });

  it('отклоняет запись без prompt', () => {
    expect(() => parsePresetImport(JSON.stringify([{ title: 'Задача', difficulty: 1 }]))).toThrow('prompt');
  });

  it('отклоняет сложность вне диапазона', () => {
    expect(() => parsePresetImport(JSON.stringify([{ title: 'Задача', prompt: 'Промпт', difficulty: 6 }]))).toThrow('difficulty');
  });
});
