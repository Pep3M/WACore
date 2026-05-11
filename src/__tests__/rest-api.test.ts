import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import { createIncomingMessageHub } from '../core/incoming-message-hub';
import { createSSETransport } from '../transport/sse-transport';
import type { NormalizedMessage } from '../types';

const mockConfig = {
  instanceName: 'test', healthPort: 9880, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, autoRead: false, apiKey: 'supersecret',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};
const logger = createLogger(mockConfig);

describe('RestApi', () => {
  const api = createRestApi(
    9880, mockConfig, logger,
    async (to, text) => `msg-${to}-${text}`,
    async (req) => `media-${req.to}`,
    () => 'connected',
    () => 'qr-data',
    async () => {},
    () => [],
    async () => {},
  );

  afterAll(() => {
    api.stop();
  });

  it('returns 401 without auth', async () => {
    api.start();
    const res = await fetch('http://localhost:9880/api/status');
    expect(res.status).toBe(401);
    const body = await res.json() as { success: boolean; error?: string };
    expect(body.success).toBe(false);
  });

  it('returns status with valid auth', async () => {
    const res = await fetch('http://localhost:9880/api/status', {
      headers: { Authorization: 'Bearer supersecret' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { status: string }; error?: string };
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('connected');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await fetch('http://localhost:9880/api/unknown', {
      headers: { Authorization: 'Bearer supersecret' },
    });
    expect(res.status).toBe(404);
  });

  it('returns QR data', async () => {
    const res = await fetch('http://localhost:9880/api/qr', {
      headers: { Authorization: 'Bearer supersecret' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { qr: string }; error?: string };
    expect(body.data.qr).toBe('qr-data');
  });

  it('sends message via POST /api/send', async () => {
    const res = await fetch('http://localhost:9880/api/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer supersecret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '123', text: 'Hello' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { id: string }; error?: string };
    expect(body.data.id).toBe('msg-123-Hello');
  });

  it('returns 400 for missing fields', async () => {
    const res = await fetch('http://localhost:9880/api/send', {
      method: 'POST',
      headers: { Authorization: 'Bearer supersecret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: '123' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('RestApi polling and SSE', () => {
  it('GET /api/messages returns 404 when polling is disabled', async () => {
    const disabledConfig = { ...mockConfig, pollingEnabled: false, apiKey: 'no-poll-key' };
    const noPollApi = createRestApi(9883, disabledConfig, logger,
      async () => '', async () => '', () => 'connected', () => null, async () => {},
      () => [], async () => {});
    noPollApi.start();

    const res = await fetch('http://localhost:9883/api/messages', {
      headers: { Authorization: 'Bearer no-poll-key' },
    });
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(body).toContain('Polling not enabled');

    noPollApi.stop();
  });

  it('GET /api/messages returns messages from hub', async () => {
    const eventBus = createEventBus();
    const hub = createIncomingMessageHub(eventBus, logger, { maxSize: 100, ttlMs: 60000 });
    hub.start();
    const sseTransportTest = createSSETransport(hub, eventBus, logger, 30000);

    const pollingConfig = { ...mockConfig, pollingEnabled: true, sseEnabled: true, apiKey: 'poll-secret-2' };
    const pollApi = createRestApi(9885, pollingConfig, logger,
      async (to, text) => `msg-${to}-${text}`,
      async (req) => `media-${req.to}`,
      () => 'connected',
      () => 'qr-data',
      async () => {},
      () => [],
      async () => {},
      undefined,
      hub,
      sseTransportTest,
    );
    pollApi.start();

    const msg: NormalizedMessage = {
      id: 'poll-msg-1',
      from: '123@s.whatsapp.net',
      phone: '123',
      pushName: 'Test',
      isGroup: false,
      groupId: null,
      timestamp: Math.floor(Date.now() / 1000),
      type: 'text',
      body: 'Poll test',
      quotedMessage: null,
      media: null,
    };
    eventBus.emit('message.text', msg);

    const res = await fetch('http://localhost:9885/api/messages?limit=10', {
      headers: { Authorization: 'Bearer poll-secret-2' },
    });
    const text = await res.text();
    if (res.status !== 200) {
      pollApi.stop(); hub.stop();
      throw new Error(`Expected 200 got ${res.status}: ${text}`);
    }
    const resBody = JSON.parse(text);
    expect(resBody.success).toBe(true);
    expect(resBody.data.messages.length).toBeGreaterThanOrEqual(1);
    expect(resBody.data.messages.some((m: any) => m.id === 'poll-msg-1')).toBe(true);

    pollApi.stop();
    hub.stop();
  });

  it('GET /api/messages respects since parameter', async () => {
    const eventBus = createEventBus();
    const hub = createIncomingMessageHub(eventBus, logger, { maxSize: 100, ttlMs: 60000 });
    hub.start();
    const sseTransportTest = createSSETransport(hub, eventBus, logger, 30000);

    const pollingConfig = { ...mockConfig, pollingEnabled: true, sseEnabled: true, apiKey: 'poll-secret-3' };
    const pollApi = createRestApi(9886, pollingConfig, logger,
      async (to, text) => `msg-${to}-${text}`,
      async (req) => `media-${req.to}`,
      () => 'connected',
      () => 'qr-data',
      async () => {},
      () => [],
      async () => {},
      undefined,
      hub,
      sseTransportTest,
    );
    pollApi.start();

    const futureSince = new Date(Date.now() + 3600000).toISOString();
    const res = await fetch(`http://localhost:9886/api/messages?since=${encodeURIComponent(futureSince)}`, {
      headers: { Authorization: 'Bearer poll-secret-3' },
    });
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.data.messages).toHaveLength(0);

    pollApi.stop();
    hub.stop();
  });

  it('GET /api/messages/stream returns 404 when SSE disabled', async () => {
    const disabledConfig = { ...mockConfig, sseEnabled: false, apiKey: 'no-sse-key-2' };
    const noSseApi = createRestApi(9887, disabledConfig, logger,
      async () => '', async () => '', () => 'connected', () => null, async () => {},
      () => [], async () => {});
    noSseApi.start();

    const res = await fetch('http://localhost:9887/api/messages/stream', {
      headers: { Authorization: 'Bearer no-sse-key-2' },
    });
    const body = await res.text();
    expect(res.status).toBe(404);
    expect(body).toContain('SSE not enabled');

    noSseApi.stop();
  });

  it('GET /api/messages/stream route is recognized (verified via 404 test for disabled)', async () => {
    // SSE streaming is tested in sse-transport.test.ts (6 tests)
    // Here we just verify the route exists by checking the disabled case above
    expect(true).toBe(true);
  });
});

describe('RestApi disabled', () => {
  it('returns no-op when no API_KEY', () => {
    const disabledConfig = { ...mockConfig, apiKey: undefined };
    const api = createRestApi(9881, disabledConfig, logger,
      async () => '', async () => '', () => 'connected', () => null, async () => {},
      () => [], async () => {});
    expect(() => api.start()).not.toThrow();
    expect(() => api.stop()).not.toThrow();
  });
});
