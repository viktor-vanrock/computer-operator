import { hasNonBlackPixels } from '@arena/ui/arena-player/screen-readiness';
import { describe, expect, it } from 'vitest';

function makePixels(count: number, value = 0, alpha = 255): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(count * 4);
  for (let index = 0; index < count; index++) {
    const offset = index * 4;
    pixels[offset] = value;
    pixels[offset + 1] = value;
    pixels[offset + 2] = value;
    pixels[offset + 3] = alpha;
  }
  return pixels;
}

describe('hasNonBlackPixels', () => {
  it('не считает полностью чёрный кадр готовым', () => {
    expect(hasNonBlackPixels(makePixels(100))).toBe(false);
  });

  it('игнорирует слабый шум и единичный яркий пиксель', () => {
    const pixels = makePixels(1_000, 10);
    pixels[0] = 255;

    expect(hasNonBlackPixels(pixels)).toBe(false);
  });

  it('считает кадр готовым, когда ярких пикселей не меньше одного процента', () => {
    const pixels = makePixels(100);
    pixels[0] = 17;

    expect(hasNonBlackPixels(pixels)).toBe(true);
  });

  it('не принимает прозрачный незаполненный кадр', () => {
    expect(hasNonBlackPixels(makePixels(100, 255, 0))).toBe(false);
  });
});
