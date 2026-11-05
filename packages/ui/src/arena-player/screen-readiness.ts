export const SCREEN_SAMPLE_WIDTH = 64;
export const SCREEN_SAMPLE_HEIGHT = 36;
export const SCREEN_BRIGHTNESS_THRESHOLD = 16;
export const SCREEN_LIT_PIXEL_RATIO = 0.01;
const PIXEL_CHANNEL_COUNT = 4;

/**
 * A frame is ready once a small but meaningful part of the desktop is visible.
 * Transparent pixels are ignored so an unpainted canvas is never considered ready.
 */
export function hasNonBlackPixels(
  pixels: Uint8ClampedArray,
  brightnessThreshold = SCREEN_BRIGHTNESS_THRESHOLD,
  litPixelRatio = SCREEN_LIT_PIXEL_RATIO
): boolean {
  const pixelCount = Math.floor(pixels.length / PIXEL_CHANNEL_COUNT);
  if (0 === pixelCount) return false;

  const requiredLitPixels = Math.max(1, Math.ceil(pixelCount * litPixelRatio));
  let litPixels = 0;

  for (let offset = 0; offset < pixelCount * PIXEL_CHANNEL_COUNT; offset += PIXEL_CHANNEL_COUNT) {
    const alpha = pixels[offset + 3] ?? 0;
    if (0 === alpha) continue;

    const red = pixels[offset] ?? 0;
    const green = pixels[offset + 1] ?? 0;
    const blue = pixels[offset + 2] ?? 0;
    if (red > brightnessThreshold || green > brightnessThreshold || blue > brightnessThreshold) {
      litPixels += 1;
      if (litPixels >= requiredLitPixels) return true;
    }
  }

  return false;
}

export function isGuacamoleScreenReady(
  displayCanvas: HTMLCanvasElement,
  sampleCanvas: HTMLCanvasElement
): boolean {
  if (displayCanvas.width <= 0 || displayCanvas.height <= 0) return false;

  sampleCanvas.width = SCREEN_SAMPLE_WIDTH;
  sampleCanvas.height = SCREEN_SAMPLE_HEIGHT;
  const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  context.clearRect(0, 0, SCREEN_SAMPLE_WIDTH, SCREEN_SAMPLE_HEIGHT);
  context.drawImage(displayCanvas, 0, 0, SCREEN_SAMPLE_WIDTH, SCREEN_SAMPLE_HEIGHT);
  const frame = context.getImageData(0, 0, SCREEN_SAMPLE_WIDTH, SCREEN_SAMPLE_HEIGHT);
  return hasNonBlackPixels(frame.data);
}
