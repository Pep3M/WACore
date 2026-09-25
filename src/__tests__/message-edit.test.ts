import { describe, expect, it, mock, afterAll } from 'bun:test';
import { normalizeMessage } from '../core/normalize-message';
import { createMessageSender } from '../services/message-sender';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import { createSentRegistry } from '../services/sent-registry';
import type { BaileysClient } from '../baileys/client';
import type { MessageSender } from '../services/message-sender';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';

const PORT = 19931;

const mockConfig = {
  instanceName: 'test', healthPort: 19932, apiPort: PORT, logLevel: 'error' as const,
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

const ID_ORIGINAL = 'ORIG-1';
const ID_SOBRE = 'SOBRE-9';
const CHAT = '34600111222@s.whatsapp.net';

function edicionCruda(over: Record<string, any> = {}) {
  return {
    key: { remoteJid: CHAT, id: ID_SOBRE, fromMe: false },
    messageTimestamp: 1_800_000_100,
    pushName: 'Ana',
    message: {
      protocolMessage: {
        key: { remoteJid: CHAT, id: ID_ORIGINAL, fromMe: false },
        type: 14,
        editedMessage: { conversation: 'texto corregido' },
        ...over,
      },
    },
  };
}

describe('edición entrante', () => {
  it('se publica con el id del mensaje ORIGINAL, no el del sobre', () => {
    const n = normalizeMessage(edicionCruda());
    expect(n?.id).toBe(ID_ORIGINAL);
  });

  it('llega marcada como edición y con el texto nuevo', () => {
    const n = normalizeMessage(edicionCruda());
    expect(n?.isEdit).toBe(true);
    expect(n?.type).toBe('text');
    expect(n?.body).toBe('texto corregido');
  });

  it('acepta el tipo como literal además de como número', () => {
    const n = normalizeMessage(edicionCruda({ type: 'MESSAGE_EDIT' }));
    expect(n?.isEdit).toBe(true);
    expect(n?.id).toBe(ID_ORIGINAL);
  });

  it('un mensaje normal no viene marcado como edición', () => {
    const n = normalizeMessage({
      key: { remoteJid: CHAT, id: 'X', fromMe: false },
      messageTimestamp: 1_800_000_000,
      message: { conversation: 'hola' },
    });
    expect(n?.isEdit).toBeUndefined();
    expect(n?.id).toBe('X');
  });

  it('otro protocolMessage que no es edición se sigue descartando', () => {
    // type 0 = REVOKE. No es una edición y no debe colarse como tal.
    const n = normalizeMessage(edicionCruda({ type: 0 }));
    expect(n).toBeNull();
  });

  it('sin clave del original no se inventa nada: se descarta', () => {
    const n = normalizeMessage(edicionCruda({ key: { remoteJid: CHAT } }));
    expect(n).toBeNull();
  });

  it('sin contenido editado se descarta', () => {
    const n = normalizeMessage(edicionCruda({ editedMessage: undefined }));
    expect(n).toBeNull();
  });

  it('conserva el grupo al desenvolver', () => {
    const grupo = '120000@g.us';
    const crudo = edicionCruda();
    crudo.key.remoteJid = grupo;
    crudo.message.protocolMessage.key.remoteJid = grupo;
    const n = normalizeMessage(crudo);
    expect(n?.isGroup).toBe(true);
    expect(n?.groupId).toBe(grupo);
  });

  it('una edición de un adjunto se normaliza por su contenido nuevo', () => {
    const n = normalizeMessage(edicionCruda({
      editedMessage: { imageMessage: { caption: 'pie corregido', mimetype: 'image/jpeg' } },
    }));
    expect(n?.type).toBe('image');
    expect(n?.body).toBe('pie corregido');
    expect(n?.id).toBe(ID_ORIGINAL);
  });
});

describe('editar un mensaje propio', () => {
  function crearSender(sendMessage: any): { sender: MessageSender; registry: ReturnType<typeof createSentRegistry> } {
    const registry = createSentRegistry({ ttlMs: 60_000, max: 100 });
    const client = { socket: {}, sendMessage } as unknown as BaileysClient;
    const sender = createMessageSender(client, createEventBus(), logger, undefined, registry);
    return { sender, registry };
  }

  it('manda el texto nuevo con la clave del mensaje a editar', async () => {
    const sendMessage = mock(async () => ({ key: { id: ID_SOBRE, remoteJid: CHAT } }));
    const { sender } = crearSender(sendMessage);

    await sender.edit(CHAT, ID_ORIGINAL, 'ya va bien');

    const [jid, contenido] = sendMessage.mock.calls[0] as any[];
    expect(jid).toBe(CHAT);
    expect(contenido.text).toBe('ya va bien');
    expect(contenido.edit).toEqual({ remoteJid: CHAT, id: ID_ORIGINAL, fromMe: true });
  });

  it('registra el envío para que su eco no pase por escrito desde el móvil', async () => {
    const sendMessage = mock(async () => ({ key: { id: ID_SOBRE, remoteJid: CHAT } }));
    const { sender, registry } = crearSender(sendMessage);

    await sender.edit(CHAT, ID_ORIGINAL, 'ya va bien');

    expect(registry.has(CHAT, ID_SOBRE)).toBe(true);
  });

  it('acepta el chat sin dominio', async () => {
    const sendMessage = mock(async () => ({ key: { id: ID_SOBRE, remoteJid: CHAT } }));
    const { sender } = crearSender(sendMessage);

    await sender.edit('34600111222', ID_ORIGINAL, 'x');

    expect((sendMessage.mock.calls[0] as any[])[0]).toBe(CHAT);
  });

  it('propaga el error de la red', async () => {
    const sendMessage = mock(async () => { throw new Error('nope'); });
    const { sender } = crearSender(sendMessage);

    await expect(sender.edit(CHAT, ID_ORIGINAL, 'x')).rejects.toThrow('nope');
  });
});

// ─── Ruta ───────────────────────────────────────────────────

function crearSesion(messageSender: MessageSender): ManagedSession {
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

describe('PATCH /api/messages/:chatId/:messageId', () => {
  const edit = mock(async () => ID_SOBRE);
  const messageSender = {
    sendText: mock(async () => 'x'), sendMedia: mock(async () => 'x'),
    sendSticker: mock(async () => 'x'), sendLocation: mock(async () => 'x'),
    sendContact: mock(async () => 'x'), sendPtt: mock(async () => 'x'),
    sendList: mock(async () => 'x'), sendButtons: mock(async () => 'x'),
    revoke: mock(async () => {}), edit, pin: mock(async () => 'x'),
    react: mock(async () => {}), forward: mock(async () => []),
  } as unknown as MessageSender;

  const sessionManager: SessionManager = {
    bootstrap: async () => {}, get: () => crearSesion(messageSender),
    getOrLegacy: () => crearSesion(messageSender), create: async () => crearSesion(messageSender),
    destroy: async () => {}, list: () => [], stopAll: async () => {},
  };

  const api = createRestApi(PORT, mockConfig, logger, sessionManager);
  api.start();
  afterAll(() => { api.stop(); });

  const editar = (body: unknown) =>
    fetch(`http://localhost:${PORT}/api/messages/${encodeURIComponent(CHAT)}/${ID_ORIGINAL}`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('edita', async () => {
    const res = await editar({ text: 'corregido' });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.edited).toBe(true);
    expect(json.data.messageId).toBe(ID_ORIGINAL);
  });

  it('rechaza que falte el texto', async () => {
    expect((await editar({})).status).toBe(400);
  });

  it('rechaza un texto vacío', async () => {
    expect((await editar({ text: '   ' })).status).toBe(400);
  });

  it('el preflight permite PATCH y PUT', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/messages/x/y`, { method: 'OPTIONS' });
    const permitidos = res.headers.get('access-control-allow-methods') ?? '';
    expect(permitidos).toContain('PATCH');
    expect(permitidos).toContain('PUT');
  });
});
