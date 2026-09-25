import { describe, expect, it, mock, afterAll } from 'bun:test';
import { createMessageSender } from '../services/message-sender';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { BaileysClient } from '../baileys/client';
import type { MessageSender } from '../services/message-sender';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';

const PORT = 19971;
const CHAT = '34600111222@s.whatsapp.net';

const mockConfig = {
  instanceName: 'test', healthPort: 19972, apiPort: PORT, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, autoRead: false, apiKey: 'k',
  mediaDir: '/tmp/media', mediaAutoDownload: false, mediaBaseUrl: `http://localhost:${PORT}`,
};
const logger = createLogger(mockConfig);

describe('fijar un mensaje', () => {
  function crear(sendMessage: any): MessageSender {
    return createMessageSender({ socket: {}, sendMessage } as unknown as BaileysClient, createEventBus(), logger);
  }

  it('fija con el tipo 1 y la clave del mensaje', async () => {
    const sendMessage = mock(async () => ({ key: { id: 'P1', remoteJid: CHAT } }));
    await crear(sendMessage).pin(CHAT, 'MSG1', true);
    const [jid, contenido] = sendMessage.mock.calls[0] as any[];
    expect(jid).toBe(CHAT);
    expect(contenido.type).toBe(1);
    expect(contenido.pin).toEqual({ remoteJid: CHAT, id: 'MSG1', fromMe: true });
  });

  it('desfijar usa el tipo 2 y no manda duración', async () => {
    const sendMessage = mock(async () => ({ key: { id: 'P1', remoteJid: CHAT } }));
    await crear(sendMessage).pin(CHAT, 'MSG1', false, 86_400);
    const contenido = (sendMessage.mock.calls[0] as any[])[1];
    expect(contenido.type).toBe(2);
    expect(contenido.time).toBeUndefined();
  });

  it('pasa la duración al fijar', async () => {
    const sendMessage = mock(async () => ({ key: { id: 'P1', remoteJid: CHAT } }));
    await crear(sendMessage).pin(CHAT, 'MSG1', true, 604_800);
    expect((sendMessage.mock.calls[0] as any[])[1].time).toBe(604_800);
  });

  it('permite fijar un mensaje del cliente, no solo propio', async () => {
    const sendMessage = mock(async () => ({ key: { id: 'P1', remoteJid: CHAT } }));
    await crear(sendMessage).pin(CHAT, 'MSG1', true, undefined, false);
    expect((sendMessage.mock.calls[0] as any[])[1].pin.fromMe).toBe(false);
  });

  it('propaga el error', async () => {
    const sendMessage = mock(async () => { throw new Error('nope'); });
    await expect(crear(sendMessage).pin(CHAT, 'MSG1', true)).rejects.toThrow('nope');
  });
});

// ─── Ruta de fijado ─────────────────────────────────────────

function sesion(messageSender: MessageSender): ManagedSession {
  return {
    sessionId: 'test', accountId: null, userId: null,
    client: {} as any, messageSender,
    presenceManager: {} as any, readReceiptManager: {} as any,
    groupManager: {} as any, profileManager: {} as any, labelManager: {} as any, chatManager: {} as any,
    localEventBus: createEventBus(),
    start: async () => {}, stop: async () => {}, logout: async () => {},
    getInfo: () => ({ sessionId: 'test', accountId: null, userId: null, status: 'connected' as any, phoneNumber: null, displayName: null, lastSeenAt: null }),
  };
}

describe('POST /api/messages/:chatId/:messageId/pin', () => {
  const pin = mock(async () => 'P1');
  const sender = {
    sendText: mock(async () => 'x'), sendMedia: mock(async () => 'x'), sendSticker: mock(async () => 'x'),
    sendLocation: mock(async () => 'x'), sendContact: mock(async () => 'x'), sendPtt: mock(async () => 'x'),
    sendList: mock(async () => 'x'), sendButtons: mock(async () => 'x'),
    revoke: mock(async () => {}), edit: mock(async () => 'x'), pin,
    react: mock(async () => {}), forward: mock(async () => []),
  } as unknown as MessageSender;
  const s = sesion(sender);
  const sm: SessionManager = {
    bootstrap: async () => {}, get: () => s, getOrLegacy: () => s, create: async () => s,
    destroy: async () => {}, list: () => [], stopAll: async () => {},
  };

  const api = createRestApi(PORT, mockConfig, logger, sm);
  api.start();
  afterAll(() => { api.stop(); });

  const fijar = (body: unknown) =>
    fetch(`http://localhost:${PORT}/api/messages/${encodeURIComponent(CHAT)}/MSG1/pin`, {
      method: 'POST',
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('fija', async () => {
    const res = await fijar({ pin: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.pinned).toBe(true);
  });

  it('acepta las tres duraciones de la aplicación', async () => {
    for (const s of [86_400, 604_800, 2_592_000]) {
      expect((await fijar({ pin: true, seconds: s })).status).toBe(200);
    }
  });

  it('rechaza una duración que la aplicación no sabe representar', async () => {
    const res = await fijar({ pin: true, seconds: 3600 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain('24h, 7d, 30d');
  });

  it('exige el campo pin', async () => {
    expect((await fijar({})).status).toBe(400);
  });
});
