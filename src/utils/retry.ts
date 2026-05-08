export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  factor: number;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  onAttempt?: (attempt: number, error: Error) => void,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (onAttempt) onAttempt(attempt, lastError);
      if (attempt >= options.maxAttempts) break;

      const delay = calculateDelay(attempt, options);
      await sleep(delay);
    }
  }

  throw lastError ?? new Error('Retry failed');
}

export function calculateDelay(attempt: number, options: RetryOptions): number {
  const delay = Math.min(
    options.initialDelay * Math.pow(options.factor, attempt - 1),
    options.maxDelay,
  );
  return delay * (0.5 + Math.random() * 0.5);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
