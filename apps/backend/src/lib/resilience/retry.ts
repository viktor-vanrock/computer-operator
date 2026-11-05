export interface RetryOptions {
  delaysMs?: readonly number[];
  shouldRetry: (error: unknown) => boolean;
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_DELAYS_MS = [500, 1_000, 2_000] as const;

function sleep(ms: number): Promise<void> {
  const jitter = Math.floor(Math.random() * Math.max(1, ms * 0.2));
  return new Promise((resolve) => setTimeout(resolve, ms + jitter));
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const delay = delays[attempt];
      if (delay === undefined || !options.shouldRetry(error)) throw error;
      options.onRetry?.(error, attempt + 1);
      await sleep(delay);
    }
  }
}
