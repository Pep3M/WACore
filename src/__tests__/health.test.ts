import { describe, expect, it, afterAll } from 'bun:test';
import { createHealthMonitor } from '../core/health';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9882, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000,
  nodeEnv: 'test',
};
const logger = createLogger(mockConfig);

describe('HealthMonitor', () => {
  const monitor = createHealthMonitor(9882, logger, 'test-instance');

  afterAll(() => {
    monitor.stop();
  });

  it('returns disconnected initially', () => {
    const status = monitor.getStatus();
    expect(status.status).toBe('unhealthy');
    expect(status.connection).toBe('disconnected');
    expect(status.phoneNumber).toBeNull();
  });

  it('reports healthy when connected', () => {
    monitor.updateConnection('connected', '123456');
    const status = monitor.getStatus();
    expect(status.status).toBe('healthy');
    expect(status.connection).toBe('connected');
    expect(status.phoneNumber).toBe('123456');
  });

  it('reports degraded when connecting', () => {
    monitor.updateConnection('connecting');
    const status = monitor.getStatus();
    expect(status.status).toBe('degraded');
  });

  it('reports degraded when awaiting QR', () => {
    monitor.updateConnection('awaiting-qr');
    const status = monitor.getStatus();
    expect(status.status).toBe('degraded');
  });

  it('tracks reconnection count', () => {
    const before = monitor.getStatus().reconnections;
    monitor.incrementReconnections();
    expect(monitor.getStatus().reconnections).toBe(before + 1);
  });

  it('serves health endpoint', async () => {
    monitor.start();
    monitor.updateConnection('connected');
    const res = await fetch('http://localhost:9882/health');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; connection: string; phoneNumber?: string | null; uptimeSeconds: number; reconnections: number };
    expect(body.status).toBe('healthy');
    expect(body.connection).toBe('connected');
  });

  it('returns 404 for non-health paths', async () => {
    const res = await fetch('http://localhost:9882/');
    expect(res.status).toBe(404);
  });
});
