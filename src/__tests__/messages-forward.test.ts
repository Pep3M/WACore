import { describe, expect, it, afterAll, mock } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import { createMessageSender } from '../services/message-sender';
import { createRawMessageCache } from '../services/raw-message-cache';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import type { MessageSender } from '../services/message-sender';
import type { BaileysClient } from '../baileys/client';

const PORT = 19910;

const mockConfig = {
  instanceName: 'test', healthPort: 19911, apiPort: PORT, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, autoRead: false, apiKey: 'k',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: `http://localhost:${PORT}`,
};
const logger = createLogger(mockConfig);
const authHeaders = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };

function createMockClient(): BaileysClient {
  let counter = 0;
  return {
    socket: null,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    sendMessage: mock(async (_jid: string) => ({ key: { id: `new-${++counter}`, remoteJid: _jid, fromMe: true } })),
    sendPresenceUpdate: mock(async () => {}),
    presenceSubscribe: mock(async () => {}),
    getConnectionStatus: mock(() => 'connected' as const),
    getQr: mock(() => null),
    logout: mock(async () => {}),
    connect: mock(async () => {}),
    getContacts: mock(() => []),
    readMessages: mock(async () => {}),
    uploadPreKeysToServerIfRequired: mock(async () => {}),
  } as unknown as BaileysClient;
}

function createSenderWithCache() {
  const client = createMockClient();
  const bus = createEventBus();
  const cache = createRawMessageCache({ ttlMs: 60000, max: 100 });
  const sender = createMessageSender(client, bus, logger, cache);
  return { client, bus, cache, sender };
}

function makeRaw(remoteJid: string, id: string, message: Record<string, unknown> = { conversation: 'hi' }) {
  return { key: { remoteJid, id, fromMe: false }, message };
}

describe('MessageSender.forward', () => {
  it('forwards a cached raw message to a single destination', async () => {
    const { client, cache, sender } = createSenderWithCache();
    cache.put(makeRaw('5215511111111@s.whatsapp.net', 'SRC-1'));

    const results = await sender.forward('5215511111111@s.whatsapp.net', 'SRC-1', ['5215522222222']);

    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.to).toBe('5215522222222@s.whatsapp.net');
    expect(results[0]!.id).toBe('new-1');
    const call = (client.sendMessage as any).mock.calls.at(-1);
    expect(call[0]).toBe('5215522222222@s.whatsapp.net');
    expect(call[1]).toEqual({ forward: { key: { remoteJid: '5215511111111@s.whatsapp.net', id: 'SRC-1', fromMe: false }, message: { conversation: 'hi' } } });
  });

  it('returns not_found without calling sendMessage when raw is absent', async () => {
    const { client, sender } = createSenderWithCache();

    const results = await sender.forward('5215511111111@s.whatsapp.net', 'MISSING', ['5215522222222']);

    expect(results).toEqual([{ to: '5215522222222@s.whatsapp.net', id: null, ok: false, error: 'not_found' }]);
    expect((client.sendMessage as any).mock.calls.length).toBe(0);
  });

  it('handles mixed success/failure across destinations', async () => {
    const { client, cache, sender } = createSenderWithCache();
    cache.put(makeRaw('5215511111111@s.whatsapp.net', 'SRC-2'));
    let seen = 0;
    (client.sendMessage as any) = mock(async (jid: string) => {
      seen++;
      if (seen === 2) throw new Error('baileys transient');
      return { key: { id: `ok-${seen}`, remoteJid: jid, fromMe: true } };
    });

    const results = await sender.forward('5215511111111@s.whatsapp.net', 'SRC-2', ['5215522222222', '5215533333333']);

    expect(results).toHaveLength(2);
    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    expect(results[1]!.error).toContain('baileys transient');
  });

  it('emits message.forwarded event on success', async () => {
    const { bus, cache, sender } = createSenderWithCache();
    cache.put(makeRaw('5215511111111@s.whatsapp.net', 'SRC-3'));
    let event: any = null;
    (bus as any).on('message.forwarded', (e: unknown) => { event = e; });

    await sender.forward('5215511111111@s.whatsapp.net', 'SRC-3', ['5215522222222']);

    expect(event).not.toBeNull();
    expect(event.from).toBe('5215511111111@s.whatsapp.net');
    expect(event.sourceMessageId).toBe('SRC-3');
    expect(event.to).toBe('5215522222222@s.whatsapp.net');
    expect(typeof event.newMessageId).toBe('string');
  });
});

describe('RawMessageCache', () => {
  it('expires entries after ttlMs', async () => {
    const cache = createRawMessageCache({ ttlMs: 20, max: 10 });
    cache.put(makeRaw('a@s.whatsapp.net', 'X'));
    expect(cache.get('a@s.whatsapp.net', 'X')).toBeDefined();
    await new Promise(r => setTimeout(r, 40));
    expect(cache.get('a@s.whatsapp.net', 'X')).toBeUndefined();
  });

  it('drops oldest entries when exceeding max', () => {
    const cache = createRawMessageCache({ ttlMs: 60000, max: 2 });
    cache.put(makeRaw('a@s.whatsapp.net', 'A'));
    cache.put(makeRaw('a@s.whatsapp.net', 'B'));
    cache.put(makeRaw('a@s.whatsapp.net', 'C'));
    expect(cache.get('a@s.whatsapp.net', 'A')).toBeUndefined();
    expect(cache.get('a@s.whatsapp.net', 'B')).toBeDefined();
    expect(cache.get('a@s.whatsapp.net', 'C')).toBeDefined();
  });
});

function createForwardingSender(overrides: Partial<MessageSender> = {}): MessageSender {
  return {
    sendText: mock(async () => 'msg-id'),
    sendMedia: mock(async () => 'msg-id'),
    sendSticker: mock(async () => 'msg-id'),
    sendLocation: mock(async () => 'msg-id'),
    sendContact: mock(async () => 'msg-id'),
    sendPtt: mock(async () => 'msg-id'),
    sendList: mock(async () => 'msg-id'),
    sendButtons: mock(async () => 'msg-id'),
    revoke: mock(async () => {}),
    edit: mock(async () => "EDIT1"),
    pin: mock(async () => "PIN1"),
    react: mock(async () => {}),
    forward: mock(async () => []),
    ...overrides,
  };
}

function createMockSession(sender: MessageSender): ManagedSession {
  return {
    sessionId: 'test',
    accountId: null,
    userId: null,
    client: {} as any,
    messageSender: sender,
    presenceManager: {} as any,
    readReceiptManager: {} as any,
    groupManager: {} as any,
    profileManager: {} as any,
    labelManager: {} as any,
    chatManager: {} as any,
    localEventBus: createEventBus(),
    start: async () => {},
    stop: async () => {},
    logout: async () => {},
    getInfo: () => ({ sessionId: 'test', accountId: null, userId: null, status: 'connected' as any, phoneNumber: null, displayName: null, lastSeenAt: null }),
  };
}

function createMockSessionManager(session: ManagedSession): SessionManager {
  return {
    bootstrap: async () => {},
    get: () => session,
    getOrLegacy: () => session,
    create: async () => session,
    destroy: async () => {},
    list: () => [session.getInfo()],
    stopAll: async () => {},
  };
}

describe('POST /api/forward', () => {
  const sender = createForwardingSender({
    forward: mock(async (_from: string, _msgId: string, to: string[]) => to.map((t, i) => ({ to: t, id: `NEW-${i}`, ok: true }))),
  });
  const session = createMockSession(sender);
  const api = createRestApi(PORT, mockConfig, logger, createMockSessionManager(session));
  api.start();
  afterAll(() => { api.stop(); });

  it('returns 200 when all destinations succeed', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/forward`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ from: '5215511111111@s.whatsapp.net', messageId: 'SRC', to: ['5215522222222@s.whatsapp.net'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.results).toHaveLength(1);
    expect(sender.forward).toHaveBeenCalledWith('5215511111111@s.whatsapp.net', 'SRC', ['5215522222222@s.whatsapp.net']);
  });

  it('is aliased at /api/forward', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/forward`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ from: 'a@s.whatsapp.net', messageId: 'ID', to: ['b@s.whatsapp.net'] }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when source message not in cache', async () => {
    const notFoundSender = createForwardingSender({
      forward: mock(async (_from: string, _msgId: string, to: string[]) => to.map(t => ({ to: t, id: null, ok: false, error: 'not_found' }))),
    });
    const localApi = createRestApi(PORT + 1, mockConfig, logger, createMockSessionManager(createMockSession(notFoundSender)));
    localApi.start();
    try {
      const res = await fetch(`http://localhost:${PORT + 1}/api/forward`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ from: 'a@s.whatsapp.net', messageId: 'MISS', to: ['b@s.whatsapp.net'] }),
      });
      expect(res.status).toBe(404);
      const body = await res.json() as any;
      expect(body.error).toBe('source_message_not_found');
    } finally {
      localApi.stop();
    }
  });

  it('returns 207 on partial success', async () => {
    const partialSender = createForwardingSender({
      forward: mock(async () => [
        { to: 'b@s.whatsapp.net', id: 'NEW-1', ok: true },
        { to: 'c@s.whatsapp.net', id: null, ok: false, error: 'boom' },
      ]),
    });
    const localApi = createRestApi(PORT + 2, mockConfig, logger, createMockSessionManager(createMockSession(partialSender)));
    localApi.start();
    try {
      const res = await fetch(`http://localhost:${PORT + 2}/api/forward`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ from: 'a@s.whatsapp.net', messageId: 'X', to: ['b@s.whatsapp.net', 'c@s.whatsapp.net'] }),
      });
      expect(res.status).toBe(207);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.data.results).toHaveLength(2);
      expect(body.data.results[0].ok).toBe(true);
      expect(body.data.results[1].ok).toBe(false);
    } finally {
      localApi.stop();
    }
  });

  it('rejects missing from', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/forward`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ messageId: 'X', to: ['b@s.whatsapp.net'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing messageId', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/forward`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ from: 'a@s.whatsapp.net', to: ['b@s.whatsapp.net'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects empty to array', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/forward`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ from: 'a@s.whatsapp.net', messageId: 'X', to: [] }),
    });
    expect(res.status).toBe(400);
  });
});
