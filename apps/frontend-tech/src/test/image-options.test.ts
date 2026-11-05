import { describe, expect, it } from 'vitest';

import {
  buildImageOptions,
  imageSelectionAfterLoad,
  parseImageSelection,
  toSessionImageFields,
} from '@/features/task-selection/image-options';

describe('image options', () => {
  it('ставит Ubuntu первой и сокращает image id только в label', () => {
    expect(buildImageOptions([
      { imageId: '8b6ce2c8-1234-5678', name: 'fleet-ubuntu-example' },
      { imageId: 'short-id', name: 'short' },
    ])).toEqual([
      { value: 'preset:ubuntu2204', label: 'Ubuntu' },
      { value: 'image:8b6ce2c8-1234-5678', label: 'fleet-ubuntu-example · 8b6ce2c8…' },
      { value: 'image:short-id', label: 'short · short-id' },
    ]);
  });

  it('при ошибке запроса оставляет только Ubuntu, даже если в кеше есть старые данные', () => {
    const staleImages = [{ imageId: 'cached-image-id', name: 'cached-image' }];

    expect(buildImageOptions(staleImages, true)).toEqual([
      { value: 'preset:ubuntu2204', label: 'Ubuntu' },
    ]);
  });

  it('сбрасывает выбранный кастомный образ на Ubuntu при ошибке загрузки', () => {
    expect(imageSelectionAfterLoad('image:cached-image-id', new Set())).toBe('preset:ubuntu2204');
    expect(imageSelectionAfterLoad('image:cached-image-id', new Set(['cached-image-id']))).toBe('image:cached-image-id');
    expect(imageSelectionAfterLoad('image:cached-image-id', null)).toBe('image:cached-image-id');
  });

  it('сбрасывает исчезнувший из успешного ответа образ на Ubuntu', () => {
    expect(imageSelectionAfterLoad('image:removed-image-id', new Set(['another-image-id'])))
      .toBe('preset:ubuntu2204');
  });

  it('преобразует Ubuntu и полный image id во взаимоисключающие поля сессии', () => {
    expect(toSessionImageFields('preset:ubuntu2204')).toEqual({ arenaOs: 'ubuntu2204' });
    expect(toSessionImageFields('image:8b6ce2c8-1234-5678')).toEqual({
      customImageId: '8b6ce2c8-1234-5678',
    });
  });

  it('принимает только известные значения списка', () => {
    expect(parseImageSelection('preset:ubuntu2204')).toBe('preset:ubuntu2204');
    expect(parseImageSelection('image:full-image-id')).toBe('image:full-image-id');
    expect(() => parseImageSelection('image:')).toThrow('Invalid image selection');
    expect(() => parseImageSelection('unexpected')).toThrow('Invalid image selection');
  });
});
