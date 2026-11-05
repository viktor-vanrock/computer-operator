import { describe, expect, it, vi } from 'vitest';

import { withRetry } from '@/lib/resilience/retry.js';

describe('withRetry', () => {
  it('повторяет только разрешённую transient-ошибку', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('ok');

    await expect(withRetry(operation, {
      delaysMs: [0],
      shouldRetry: () => true,
    })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('сразу возвращает постоянную ошибку', async () => {
    const error = new Error('permanent');
    const operation = vi.fn().mockRejectedValue(error);
    await expect(withRetry(operation, {
      delaysMs: [0, 0],
      shouldRetry: () => false,
    })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledOnce();
  });
});
