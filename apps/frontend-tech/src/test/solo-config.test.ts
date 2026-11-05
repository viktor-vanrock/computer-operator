import { describe, expect, it } from 'vitest';

import { SOLO_DEFAULTS } from '@/constants/session-config';
import {
  isValidNonnegativeInteger,
  isValidNonnegativeNumber,
} from '@/features/task-selection/use-task-selection';

describe('SOLO config override', () => {
  it('использует согласованные значения по умолчанию', () => {
    expect(SOLO_DEFAULTS).toEqual({
      MAX_ITERATIONS: 25,
      MODEL_RETRIES: 4,
      MOUSE_CLICK_DELAY: 0.1,
      MIN_OPERATION_DELAY: 2,
    });
  });

  it('принимает неотрицательные целые значения для итераций и повторов', () => {
    expect(isValidNonnegativeInteger(0)).toBe(true);
    expect(isValidNonnegativeInteger(25)).toBe(true);
    expect(isValidNonnegativeInteger(1.5)).toBe(false);
    expect(isValidNonnegativeInteger(-1)).toBe(false);
    expect(isValidNonnegativeInteger('')).toBe(false);
  });

  it('принимает неотрицательные дробные задержки', () => {
    expect(isValidNonnegativeNumber(0)).toBe(true);
    expect(isValidNonnegativeNumber(0.1)).toBe(true);
    expect(isValidNonnegativeNumber(-0.1)).toBe(false);
    expect(isValidNonnegativeNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidNonnegativeNumber('')).toBe(false);
  });
});
