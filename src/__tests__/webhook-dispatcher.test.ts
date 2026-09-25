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
  autoTyping: true, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
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

  it('delivers message.status ACK events when allowed', async () => {
    const bus = createEventBus();
    const cfg = { ...mockConfig, webhookEvents: ['message.status'] };
    const calls: Array<{ url: string; body: any; headers: Record<string, string> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      return new Response('ok', { status: 200 });
    }) as typeof fetch;

    try {
      const dispatcher = createWebhookDispatcher(bus, cfg, logger);
      dispatcher.start();

      bus.emit('message.status', {
        messageId: '3EB0ABC123',
        status: 4,
        statusLabel: 'read',
        chatJid: '521234567890@s.whatsapp.net',
        phone: '521234567890',
        isGroup: false,
        fromMe: true,
        timestamp: Date.now(),
        sessionId: 'acc1:user1',
        accountId: 'acc1',
        userId: 'user1',
      });

      await new Promise(r => setTimeout(r, 20));
      dispatcher.stop();

      const statusCalls = calls.filter(c => c.body?.event === 'message.status');
      expect(statusCalls).toHaveLength(1);
      expect(statusCalls[0].body.data.messageId).toBe('3EB0ABC123');
      expect(statusCalls[0].body.data.statusLabel).toBe('read');
      expect(statusCalls[0].headers['X-WACore-Event']).toBe('message.status');
    } finally {
      globalThis.fetch = originalFetch;
    }
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
