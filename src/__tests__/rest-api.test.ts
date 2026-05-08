import { describe, expect, it, afterAll } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9880, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test', apiKey: 'supersecret',
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

describe('RestApi disabled', () => {
  it('returns no-op when no API_KEY', () => {
    const disabledConfig = { ...mockConfig, apiKey: undefined };
    const api = createRestApi(9881, disabledConfig, logger,
      async () => '', async () => '', () => 'connected', () => null, async () => {});
    expect(() => api.start()).not.toThrow();
    expect(() => api.stop()).not.toThrow();
  });
});
