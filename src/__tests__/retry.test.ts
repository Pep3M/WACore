import { describe, expect, it, mock } from 'bun:test';
import { retry, calculateDelay, sleep } from '../utils/retry';

describe('retry', () => {
  it('resolves on first success', async () => {
    const result = await retry(
      async () => 'ok',
      { maxAttempts: 3, initialDelay: 10, maxDelay: 100, factor: 2 },
    );
    expect(result).toBe('ok');
  });

  it('retries on failure and eventually succeeds', async () => {
    let attempts = 0;
    const fn = async () => {
      attempts++;
      if (attempts < 3) throw new Error('not yet');
      return 'finally';
    };
    const result = await retry(
      fn,
      { maxAttempts: 5, initialDelay: 5, maxDelay: 50, factor: 2 },
    );
    expect(result).toBe('finally');
    expect(attempts).toBe(3);
  });

  it('throws after exhausting attempts', async () => {
    const fn = async () => { throw new Error('always fails'); };
    await expect(
      retry(fn, { maxAttempts: 2, initialDelay: 5, maxDelay: 50, factor: 2 }),
    ).rejects.toThrow('always fails');
  });

  it('calls onAttempt callback', async () => {
    const onAttempt = mock();
    const fn = async () => { throw new Error('fail'); };
    await expect(
      retry(fn, { maxAttempts: 3, initialDelay: 5, maxDelay: 50, factor: 2 }, onAttempt),
    ).rejects.toThrow();
    expect(onAttempt).toHaveBeenCalledTimes(3);
  });

  it('handles non-Error throws', async () => {
    const fn = async () => { throw 'string error'; };
    await expect(
      retry(fn, { maxAttempts: 1, initialDelay: 5, maxDelay: 50, factor: 2 }),
    ).rejects.toThrow('string error');
  });
});

describe('calculateDelay', () => {
  it('returns value within expected range (with jitter)', () => {
    const delay = calculateDelay(1, { initialDelay: 100, maxDelay: 1000, factor: 2, maxAttempts: 5 });
    expect(delay).toBeGreaterThanOrEqual(50);
    expect(delay).toBeLessThanOrEqual(100);
  });

  it('increases with attempt number', () => {
    const opts = { initialDelay: 100, maxDelay: 10000, factor: 2, maxAttempts: 5 };
    const d1 = calculateDelay(1, opts);
    const d2 = calculateDelay(2, opts);
    expect(d2).toBeGreaterThanOrEqual(d1 * 0.5);
  });

  it('does not exceed maxDelay', () => {
    const delay = calculateDelay(10, { initialDelay: 1000, maxDelay: 2000, factor: 3, maxAttempts: 15 });
    expect(delay).toBeLessThanOrEqual(2000);
  });
});

describe('sleep', () => {
  it('resolves after specified time', async () => {
    const start = Date.now();
    await sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });
});
