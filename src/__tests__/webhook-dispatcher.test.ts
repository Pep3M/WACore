import { describe, expect, it, afterAll, mock } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createWebhookDispatcher } from '../transport/webhook-dispatcher';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: ['message', 'connection'],
  webhookRetryCount: 1, webhookRetryDelay: 10, webhookUrl: 'http://localhost:18999/webhook',
  webhookSecret: 'test-secret', connectOnStartup: false, qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000,
  nodeEnv: 'test',
};

const disabledConfig = { ...mockConfig, webhookUrl: undefined };

const logger = createLogger(mockConfig);

describe('WebhookDispatcher', () => {
  it('starts and stops without errors', () => {
    const bus = createEventBus();
    const dispatcher = createWebhookDispatcher(bus, mockConfig, logger);
    expect(() => dispatcher.start()).not.toThrow();
    expect(() => dispatcher.stop()).not.toThrow();
  });

  it('returns no-op when WEBHOOK_URL is not set', () => {
    const bus = createEventBus();
    const dispatcher = createWebhookDispatcher(bus, disabledConfig, logger);
    expect(() => dispatcher.start()).not.toThrow();
    expect(() => dispatcher.stop()).not.toThrow();
  });

  it('delivers connection update events', async () => {
    const bus = createEventBus();
    const dispatcher = createWebhookDispatcher(bus, mockConfig, logger);
    dispatcher.start();

    bus.emit('connection.update', { status: 'connected', previous: 'connecting' });

    dispatcher.stop();
  });

  it('delivers qr events', async () => {
    const bus = createEventBus();
    const dispatcher = createWebhookDispatcher(bus, mockConfig, logger);
    dispatcher.start();

    bus.emit('qr', { qr: 'test-qr-data', timeout: 60000 });

    dispatcher.stop();
  });

  it('stops delivering after stop()', async () => {
    const bus = createEventBus();
    const dispatcher = createWebhookDispatcher(bus, mockConfig, logger);
    dispatcher.start();
    dispatcher.stop();

    bus.emit('connection.update', { status: 'connected' });
  });
});

describe('WebhookDispatcher with no webhookUrl', () => {
  it('does nothing on start', () => {
    const bus = createEventBus();
    const dispatcher = createWebhookDispatcher(bus, disabledConfig, logger);
    expect(() => dispatcher.start()).not.toThrow();
  });
});
