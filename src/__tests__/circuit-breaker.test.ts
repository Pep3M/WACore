import { describe, expect, it } from 'bun:test';
import { createCircuitBreaker } from '../transport/circuit-breaker';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};
const logger = createLogger(mockConfig);

describe('CircuitBreaker', () => {
  it('starts closed and allows requests', () => {
    const cb = createCircuitBreaker('test', 3, 5000, logger);
    expect(cb.getState()).toBe('closed');
    expect(cb.isAllowed()).toBe(true);
  });

  it('opens after threshold failures', () => {
    const cb = createCircuitBreaker('test', 3, 5000, logger);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.isAllowed()).toBe(false);
  });

  it('does not open before threshold', () => {
    const cb = createCircuitBreaker('test', 3, 5000, logger);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    expect(cb.isAllowed()).toBe(true);
  });

  it('closes on success', () => {
    const cb = createCircuitBreaker('test', 3, 5000, logger);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.isAllowed()).toBe(true);
  });

  it('transitions to half-open after reset timeout', async () => {
    const cb = createCircuitBreaker('test', 1, 50, logger);
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.isAllowed()).toBe(false);

    await Bun.sleep(60);

    expect(cb.isAllowed()).toBe(true);
    expect(cb.getState()).toBe('half-open');
  });

  it('reopens on failure in half-open state', async () => {
    const cb = createCircuitBreaker('test', 2, 50, logger);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.isAllowed()).toBe(false);

    await Bun.sleep(60);

    expect(cb.isAllowed()).toBe(true);
    expect(cb.getState()).toBe('half-open');

    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('resets to initial state', () => {
    const cb = createCircuitBreaker('test', 2, 5000, logger);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.isAllowed()).toBe(true);
  });
});
