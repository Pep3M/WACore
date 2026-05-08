import { describe, expect, it } from 'bun:test';
import { createReconnectionManager } from '../core/reconnection';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test',
};
const logger = createLogger(mockConfig);

describe('ReconnectionManager', () => {
  it('starts with attempt 0', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.getAttempt()).toBe(0);
  });

  it('should reconnect for recoverable reasons', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.shouldReconnect('timedOut')).toBe(true);
    expect(rm.shouldReconnect('connectionReplaced')).toBe(true);
    expect(rm.shouldReconnect('unavailableService')).toBe(true);
    expect(rm.shouldReconnect('restartRequired')).toBe(true);
  });

  it('should not reconnect for terminal reasons', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.shouldReconnect('loggedOut')).toBe(false);
    expect(rm.shouldReconnect('multidevice')).toBe(false);
    expect(rm.shouldReconnect('forbidden')).toBe(false);
  });

  it('increments attempt on recordFailure', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    rm.recordFailure('timedOut');
    expect(rm.getAttempt()).toBe(1);
    rm.recordFailure('timedOut');
    expect(rm.getAttempt()).toBe(2);
  });

  it('resets attempt to 0', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    rm.recordFailure('timedOut');
    rm.recordFailure('timedOut');
    rm.reset();
    expect(rm.getAttempt()).toBe(0);
  });

  it('stops reconnecting after max attempts', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    for (let i = 0; i < 10; i++) rm.recordFailure('connectionReplaced');
    expect(rm.shouldReconnect('connectionReplaced')).toBe(false);
  });

  it('returns delay based on backoff config', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    const delay = rm.getDelay('timedOut');
    expect(delay).toBeGreaterThan(0);
  });
});
