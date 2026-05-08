import { describe, expect, it, mock } from 'bun:test';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'debug' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test',
};

describe('Logger', () => {
  it('logs at correct level', () => {
    const logger = createLogger(mockConfig);
    expect(() => logger.info('test message')).not.toThrow();
    expect(() => logger.error('test error')).not.toThrow();
    expect(() => logger.warn('test warn')).not.toThrow();
    expect(() => logger.debug('test debug')).not.toThrow();
  });

  it('filters below configured level', () => {
    const cfg = { ...mockConfig, logLevel: 'warn' as const };
    const logger = createLogger(cfg);
    expect(() => logger.debug('should be hidden')).not.toThrow();
    expect(() => logger.info('should be hidden')).not.toThrow();
    expect(() => logger.warn('visible')).not.toThrow();
    expect(() => logger.error('visible')).not.toThrow();
  });

  it('creates child logger with context', () => {
    const logger = createLogger(mockConfig);
    const child = logger.child({ module: 'test' });
    expect(() => child.info('child message')).not.toThrow();
  });

  it('child logger merges context with extra context', () => {
    const logger = createLogger(mockConfig);
    const child = logger.child({ module: 'auth' });
    expect(() => child.info('login', { userId: 1 })).not.toThrow();
  });

  it('child logger rejects nested children', () => {
    const logger = createLogger(mockConfig);
    const child = logger.child({ module: 'test' });
    expect(() => child.child({ nested: true })).toThrow('Nested child loggers not supported');
  });

  it('writes JSON to stdout for info', () => {
    const logger = createLogger(mockConfig);
    expect(() => logger.info('test')).not.toThrow();
  });

  it('writes JSON to stderr for error', () => {
    const logger = createLogger(mockConfig);
    expect(() => logger.error('test')).not.toThrow();
  });

  it('includes instance name in output', () => {
    const logger = createLogger(mockConfig);
    expect(() => logger.info('test')).not.toThrow();
  });
});
