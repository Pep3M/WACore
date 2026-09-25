import { describe, expect, it, mock, afterAll } from 'bun:test';
import { createLastMessageTracker } from '../services/last-message-tracker';
import { createChatManager, MissingLastMessageError } from '../services/chat-manager';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { BaileysClient } from '../baileys/client';
import type { ChatManager } from '../services/chat-manager';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';

const PORT = 19961;
const CHAT = '34600111222@s.whatsapp.net';

const mockConfig = {
  instanceName: 'test', healthPort: 19962, apiPort: PORT, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, autoRead: false, apiKey: 'k',
  mediaDir: '/tmp/media', mediaAutoDownload: false, mediaBaseUrl: `http://localhost:${PORT}`,
};
const logger = createLogger(mockConfig);

const msg = (id: string, ts: number) => ({ key: { remoteJid: CHAT, id, fromMe: false }, messageTimestamp: ts });

describe('registro del último mensaje', () => {
  it('guarda el último de cada chat', () => {
    const t = createLastMessageTracker({ max: 10 });
    t.remember(CHAT, msg('A', 100));
    t.remember(CHAT, msg('B', 200));
    expect(t.get(CHAT)?.key.id).toBe('B');
  });

  it('un mensaje viejo no pisa al reciente', () => {
    // Tras una reconexión WhatsApp reenvía lo reciente y llegan repetidos y desordenados.
    // Si uno viejo ganara, el parche se construiría con el mensaje equivocado y no haría
    // nada, en silencio.
    const t = createLastMessageTracker({ max: 10 });
    t.remember(CHAT, msg('B', 200));
    t.remember(CHAT, msg('A', 100));
    expect(t.get(CHAT)?.key.id).toBe('B');
  });

  it('desaloja los chats más viejos al pasar del tope', () => {
    const t = createLastMessageTracker({ max: 2 });
    t.remember('a@s.whatsapp.net', msg('1', 1));
    t.remember('b@s.whatsapp.net', msg('2', 2));
    t.remember('c@s.whatsapp.net', msg('3', 3));
    expect(t.get('a@s.whatsapp.net')).toBeUndefined();
    expect(t.size()).toBe(2);
  });

  it('ignora lo que no tiene clave', () => {
    const t = createLastMessageTracker({ max: 10 });
    t.remember(CHAT, { key: { remoteJid: CHAT, id: '', fromMe: false }, messageTimestamp: 1 });
    expect(t.size()).toBe(0);
  });
});

describe('acciones sobre el chat', () => {
  function crear(socket: any, conUltimo = true) {
    const t = createLastMessageTracker({ max: 10 });
    if (conUltimo) t.remember(CHAT, msg('LAST', 500));
    return createChatManager({ socket } as unknown as BaileysClient, t, logger);
  }

  it('archivar manda el último mensaje conocido', async () => {
    const chatModify = mock(async () => {});
    await crear({ chatModify }).archive(CHAT, true);
    const [mod, jid] = chatModify.mock.calls[0] as any[];
    expect(jid).toBe(CHAT);
    expect(mod.archive).toBe(true);
    expect(mod.lastMessages[0].key.id).toBe('LAST');
  });

  it('sin último mensaje conocido NO manda el parche: se para antes', async () => {
    const chatModify = mock(async () => {});
    const m = crear({ chatModify }, false);
    await expect(m.archive(CHAT, true)).rejects.toBeInstanceOf(MissingLastMessageError);
    // Lo importante: WhatsApp aceptaría un parche con datos falsos y no haría nada,
    // devolviendo un éxito mentiroso. Mejor no mandarlo.
    expect(chatModify).not.toHaveBeenCalled();
  });

  it('acepta el último mensaje que le den cuando no lo tiene', async () => {
    const chatModify = mock(async () => {});
    const m = crear({ chatModify }, false);
    await m.archive(CHAT, true, { key: { remoteJid: CHAT, id: 'DADO', fromMe: false }, messageTimestamp: 9 });
    expect((chatModify.mock.calls[0] as any[])[0].lastMessages[0].key.id).toBe('DADO');
  });

  it('marcar leído y borrar también lo exigen', async () => {
    const chatModify = mock(async () => {});
    const m = crear({ chatModify }, false);
    await expect(m.markRead(CHAT, true)).rejects.toBeInstanceOf(MissingLastMessageError);
    await expect(m.remove(CHAT)).rejects.toBeInstanceOf(MissingLastMessageError);
    expect(chatModify).not.toHaveBeenCalled();
  });

  it('fijar y silenciar NO lo exigen', async () => {
    const chatModify = mock(async () => {});
    const m = crear({ chatModify }, false);
    await m.pin(CHAT, true);
    await m.mute(CHAT, Date.now() + 3600_000);
    expect(chatModify).toHaveBeenCalledTimes(2);
  });

  it('silenciar manda el instante tal cual, y null lo quita', async () => {
    const chatModify = mock(async () => {});
    const m = crear({ chatModify });
    const fin = Date.now() + 3600_000;
    await m.mute(CHAT, fin);
    await m.mute(CHAT, null);
    expect((chatModify.mock.calls[0] as any[])[0]).toEqual({ mute: fin });
    expect((chatModify.mock.calls[1] as any[])[0]).toEqual({ mute: null });
  });

  it('bloquear no es un parche de app-state', async () => {
    const chatModify = mock(async () => {});
    const updateBlockStatus = mock(async () => {});
    const m = crear({ chatModify, updateBlockStatus });
    await m.block(CHAT, true);
    await m.block(CHAT, false);
    expect(chatModify).not.toHaveBeenCalled();
    expect(updateBlockStatus.mock.calls[0] as unknown[]).toEqual([CHAT, 'block']);
    expect(updateBlockStatus.mock.calls[1] as unknown[]).toEqual([CHAT, 'unblock']);
  });

  it('revienta si la línea no está conectada', async () => {
    await expect(crear(null).pin(CHAT, true)).rejects.toThrow('WhatsApp socket not connected');
  });
});

// ─── Rutas ──────────────────────────────────────────────────

const chatManager: ChatManager = {
  archive: mock(async () => {}),
  markRead: mock(async () => {}),
  remove: mock(async () => {}),
  pin: mock(async () => {}),
  mute: mock(async () => {}),
  block: mock(async () => {}),
};

function sesion(): ManagedSession {
  return {
    sessionId: 'test', accountId: null, userId: null,
    client: {} as any, messageSender: {} as any,
    presenceManager: {} as any, readReceiptManager: {} as any,
    groupManager: {} as any, profileManager: {} as any, labelManager: {} as any, chatManager,
    localEventBus: createEventBus(),
    start: async () => {}, stop: async () => {}, logout: async () => {},
    getInfo: () => ({ sessionId: 'test', accountId: null, userId: null, status: 'connected' as any, phoneNumber: null, displayName: null, lastSeenAt: null }),
  };
}

const sm: SessionManager = {
  bootstrap: async () => {}, get: () => sesion(), getOrLegacy: () => sesion(),
  create: async () => sesion(), destroy: async () => {}, list: () => [], stopAll: async () => {},
};

const cab = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };

describe('rutas de chat', () => {
  const api = createRestApi(PORT, mockConfig, logger, sm);
  api.start();
  afterAll(() => { api.stop(); });

  const base = `http://localhost:${PORT}/api/chats/${encodeURIComponent(CHAT)}`;
  const post = (ruta: string, body: unknown) =>
    fetch(base + ruta, { method: 'POST', headers: cab, body: JSON.stringify(body) });

  it('archiva', async () => {
    expect((await post('/archive', { archive: true })).status).toBe(200);
  });

  it('exige que archive sea booleano', async () => {
    expect((await post('/archive', { archive: 'si' })).status).toBe(400);
  });

  it('cuando falta el último mensaje responde 409, no 500', async () => {
    (chatManager.archive as any).mockImplementationOnce(async () => {
      throw new MissingLastMessageError(CHAT);
    });
    const res = await post('/archive', { archive: true });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe('missing_last_message');
  });

  it('rechaza un lastMessage a medias', async () => {
    const res = await post('/archive', { archive: true, lastMessage: { id: 'X' } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain('messageTimestamp');
  });

  it('silenciar rechaza una duración en vez de un instante', async () => {
    // 3600 sería «silenciado hasta 1970». WhatsApp lo aceptaría sin rechistar.
    const res = await post('/mute', { muteEndTimestamp: 3600 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain('not a duration');
  });

  it('silenciar acepta un instante futuro y acepta null', async () => {
    expect((await post('/mute', { muteEndTimestamp: Date.now() + 60_000 })).status).toBe(200);
    expect((await post('/mute', { muteEndTimestamp: null })).status).toBe(200);
  });

  it('silenciar exige el campo', async () => {
    expect((await post('/mute', {})).status).toBe(400);
  });

  it('fija y bloquea', async () => {
    expect((await post('/pin', { pin: true })).status).toBe(200);
    expect((await post('/block', { block: true })).status).toBe(200);
  });

  it('borra la conversación', async () => {
    const res = await fetch(base, { method: 'DELETE', headers: cab });
    expect(res.status).toBe(200);
    expect(chatManager.remove).toHaveBeenCalled();
  });
});
