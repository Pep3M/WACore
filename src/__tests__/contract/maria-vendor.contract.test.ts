/**
 * Contrato con maria-vendor.
 *
 * maria-vendor consume WACore como una caja negra: una sola instancia (`WA_INSTANCE_NAME=maria`),
 * REST con `Authorization: Bearer <API_KEY>` y los mensajes entrantes por webhook firmado con
 * `WEBHOOK_EVENTS=message`. Estos tests fijan **exactamente** lo que su cliente
 * (`lib/wacore/client.ts`) y su receptor de webhook (`app/api/whatsapp/webhook/route.ts`) leen.
 *
 * Si uno de estos tests falla, maria-vendor se rompe en producción. Se pueden añadir campos
 * (maria-vendor ignora lo que no conoce), pero no quitar ni renombrar los que aquí se afirman,
 * ni cambiar sus tipos.
 */
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRestApi } from '../../transport/rest-api';
import { createWebhookDispatcher } from '../../transport/webhook-dispatcher';
import { createMessageRouter } from '../../core/message-router';
import { createEventBus } from '../../core/event-bus';
import { createHealthMonitor } from '../../core/health';
import { createSessionManager } from '../../sessions/session-manager';
import { createLogger } from '../../utils/logger';
import { loadConfig } from '../../config';
import type { EnvConfig } from '../../types';
import type { SessionManager, ManagedSession } from '../../sessions/session-manager';
import type { ContactStore } from '../../storage/contact-store';
import type { LabelStore } from '../../storage/label-store';
import type { PostgresSessionRegistry } from '../../storage/postgres-store';

const API_KEY = 'mv-api-key';
const INSTANCE = 'maria';
const AUTH = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

/** Estados de conexión que maria-vendor sabe interpretar (el resto cae en «needsConnect»). */
const CONNECTION_STATUSES = ['disconnected', 'connecting', 'connected', 'awaiting-qr', 'logged-out', 'failed'];

function baseConfig(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    instanceName: INSTANCE,
    healthPort: 19951,
    apiPort: 19952,
    logLevel: 'error',
    sessionStore: 'file',
    sessionDir: '/tmp',
    webhookEvents: ['message'],
    webhookRetryCount: 1,
    webhookRetryDelay: 1,
    connectOnStartup: false,
    qrTimeout: 60000,
    pollingEnabled: true,
    sseEnabled: false,
    messageBufferSize: 100,
    messageBufferTtlMs: 60000,
    sseHeartbeatMs: 30000,
    nodeEnv: 'test',
    autoTyping: false,
    typingDurationMs: 1000,
    autoRead: false,
    apiKey: API_KEY,
    mediaDir: '/tmp/media',
    mediaAutoDownload: false,
    mediaBaseUrl: 'http://localhost:19952',
    ...overrides,
  };
}

const logger = createLogger(baseConfig());

// ─── Sesión simulada ────────────────────────────────────────────────────────

interface Calls {
  sendText: Array<{ to: string; text: string; quoted?: unknown }>;
  sendMedia: Array<Record<string, unknown>>;
  presence: Array<{ to: string; type: string }>;
  connect: number;
  logout: number;
}

function createSession(calls: Calls, state: { status: string; qr: string | null; phone: string | null }): ManagedSession {
  return {
    sessionId: INSTANCE,
    accountId: null,
    userId: null,
    client: {
      socket: null,
      getConnectionStatus: () => state.status as never,
      getQr: () => state.qr,
      getContacts: () => [{ jid: '5215511111111@s.whatsapp.net', phone: '5215511111111', name: 'Ana' }],
      connect: async () => { calls.connect++; },
      start: async () => {},
      stop: async () => {},
      logout: async () => {},
    } as never,
    messageSender: {
      sendText: async (to: string, text: string, quoted?: unknown) => {
        calls.sendText.push({ to, text, quoted });
        return 'WAID-TEXT';
      },
      sendMedia: async (req: Record<string, unknown>) => {
        calls.sendMedia.push(req);
        return 'WAID-MEDIA';
      },
    } as never,
    presenceManager: {
      setPresence: async (to: string, type: string) => { calls.presence.push({ to, type }); },
      startTyping: () => {},
      stopTyping: () => {},
      sendWithTyping: async (_jid: string, fn: () => Promise<unknown>) => fn(),
      stop: () => {},
    } as never,
    readReceiptManager: { sendReadReceipt: async () => {}, start: () => {}, stop: () => {} } as never,
    groupManager: {} as never,
    profileManager: {} as never,
    labelManager: {} as never,
    chatManager: {} as never,
    catalogManager: {} as never,
    localEventBus: createEventBus(),
    start: async () => {},
    stop: async () => {},
    logout: async () => { calls.logout++; state.status = 'logged-out'; },
    getInfo: () => ({
      sessionId: INSTANCE,
      accountId: null,
      userId: null,
      status: state.status as never,
      phoneNumber: state.phone,
      displayName: null,
      lastSeenAt: null,
    }),
  } as unknown as ManagedSession;
}

function singleSessionManager(session: ManagedSession): SessionManager {
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

// ─── REST ───────────────────────────────────────────────────────────────────

describe('contrato maria-vendor · REST', () => {
  const PORT = 19952;
  const BASE = `http://localhost:${PORT}`;
  const calls: Calls = { sendText: [], sendMedia: [], presence: [], connect: 0, logout: 0 };
  const state = { status: 'connected', qr: null as string | null, phone: '5215599999999' };
  const api = createRestApi(PORT, baseConfig(), logger, singleSessionManager(createSession(calls, state)));

  beforeAll(() => api.start());
  afterAll(() => api.stop());

  describe('auth', () => {
    it('acepta Authorization: Bearer <API_KEY>', async () => {
      const res = await fetch(`${BASE}/api/status`, { headers: AUTH });
      expect(res.status).toBe(200);
    });

    it('sin cabecera → 401 {success:false, error:"Unauthorized"}', async () => {
      const res = await fetch(`${BASE}/api/status`);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    });

    it('con una clave equivocada → 401', async () => {
      const res = await fetch(`${BASE}/api/status`, { headers: { Authorization: 'Bearer otra' } });
      expect(res.status).toBe(401);
    });

    it('acepta ?api_key= como alternativa', async () => {
      const res = await fetch(`${BASE}/api/status?api_key=${API_KEY}`);
      expect(res.status).toBe(200);
    });

    /** La única credencial es la API key: cualquier otro bearer (un JWT, por ejemplo) se rechaza. */
    it('rechaza cualquier bearer que no sea la API key', async () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIiwiYWNjb3VudF9pZCI6IjEiLCJ1c2VyX2lkIjoiMSJ9.x';
      const res = await fetch(`${BASE}/api/status`, { headers: { Authorization: `Bearer ${jwt}` } });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/send', () => {
    it('{to, text} con dígitos pelados → 200 {success:true, data:{id}}', async () => {
      const res = await fetch(`${BASE}/api/send`, {
        method: 'POST', headers: AUTH, body: JSON.stringify({ to: '5215511111111', text: 'hola' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; data: { id: unknown } };
      expect(body.success).toBe(true);
      expect(typeof body.data.id).toBe('string');
      expect(calls.sendText.at(-1)).toMatchObject({ to: '5215511111111', text: 'hola' });
    });

    it('sin text → 400 {success:false, error:string}', async () => {
      const res = await fetch(`${BASE}/api/send`, {
        method: 'POST', headers: AUTH, body: JSON.stringify({ to: '5215511111111' }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { success: boolean; error: unknown };
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
    });

    it('cita un mensaje con quotedMessageId', async () => {
      const res = await fetch(`${BASE}/api/send`, {
        method: 'POST', headers: AUTH,
        body: JSON.stringify({ to: '5215511111111', text: 'respondo', quotedMessageId: 'WAID-ORIG' }),
      });
      expect(res.status).toBe(200);
      expect(calls.sendText.at(-1)?.quoted).toMatchObject({ id: 'WAID-ORIG' });
    });
  });

  describe('POST /api/send-media', () => {
    it('{to, type, url, caption, mimetype, filename} → 200 {success:true, data:{id}}', async () => {
      const payload = {
        to: '5215511111111', type: 'document', url: 'https://example.com/a.pdf',
        caption: 'factura', mimetype: 'application/pdf', filename: 'a.pdf',
      };
      const res = await fetch(`${BASE}/api/send-media`, { method: 'POST', headers: AUTH, body: JSON.stringify(payload) });
      expect(res.status).toBe(200);
      const body = await res.json() as { success: boolean; data: { id: unknown } };
      expect(body.success).toBe(true);
      expect(typeof body.data.id).toBe('string');
      expect(calls.sendMedia.at(-1)).toMatchObject(payload);
    });
  });

  describe('POST /api/presence', () => {
    it('{to, type:"composing"} sin duration → 200 {success:true}', async () => {
      const res = await fetch(`${BASE}/api/presence`, {
        method: 'POST', headers: AUTH, body: JSON.stringify({ to: '5215511111111', type: 'composing' }),
      });
      expect(res.status).toBe(200);
      expect((await res.json() as { success: boolean }).success).toBe(true);
    });

    it('acepta los cinco tipos que usa maria-vendor', async () => {
      for (const type of ['composing', 'recording', 'paused', 'available', 'unavailable']) {
        const res = await fetch(`${BASE}/api/presence`, {
          method: 'POST', headers: AUTH, body: JSON.stringify({ to: '5215511111111', type }),
        });
        expect(res.status).toBe(200);
      }
    });

    it('type inválido → 400', async () => {
      const res = await fetch(`${BASE}/api/presence`, {
        method: 'POST', headers: AUTH, body: JSON.stringify({ to: '5215511111111', type: 'bailando' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/status', () => {
    it('devuelve status, instance, connection y phoneNumber', async () => {
      state.status = 'connected';
      const res = await fetch(`${BASE}/api/status`, { headers: AUTH });
      const body = await res.json() as { success: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('connected');
      expect(CONNECTION_STATUSES).toContain(body.data.status as string);
      expect(body.data.instance).toBe(INSTANCE);
      // maria-vendor pinta el teléfono de la línea con este campo.
      expect(body.data.phoneNumber).toBe('5215599999999');
      expect(body.data.connection).toBe('connected');
      expect(typeof body.data.uptimeSeconds).toBe('number');
      expect(typeof body.data.reconnections).toBe('number');
    });

    it('"awaiting-qr" se escribe con guion', async () => {
      state.status = 'awaiting-qr';
      const res = await fetch(`${BASE}/api/status`, { headers: AUTH });
      const body = await res.json() as { data: { status: string } };
      expect(body.data.status).toBe('awaiting-qr');
      state.status = 'connected';
    });
  });

  describe('GET /api/qr', () => {
    it('con QR pendiente → 200 {success:true, data:{qr:string}}', async () => {
      state.qr = '2@abc,def';
      const res = await fetch(`${BASE}/api/qr`, { headers: AUTH });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { qr: '2@abc,def' } });
    });

    it('sin QR → 404 {success:false, error:string}', async () => {
      state.qr = null;
      const res = await fetch(`${BASE}/api/qr`, { headers: AUTH });
      expect(res.status).toBe(404);
      const body = await res.json() as { success: boolean; error: unknown };
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
    });
  });

  describe('POST /api/connect', () => {
    it('sin body → 200 {success:true, data:{connecting:true}}', async () => {
      const res = await fetch(`${BASE}/api/connect`, { method: 'POST', headers: AUTH });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { connecting: true } });
    });
  });

  describe('GET /api/contacts', () => {
    it('devuelve data.contacts[] con jid, phone y name', async () => {
      const res = await fetch(`${BASE}/api/contacts`, { headers: AUTH });
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { contacts: Array<Record<string, unknown>> } };
      expect(Array.isArray(body.data.contacts)).toBe(true);
      expect(body.data.contacts[0]).toMatchObject({ jid: '5215511111111@s.whatsapp.net', phone: '5215511111111', name: 'Ana' });
    });
  });

  describe('DELETE /api/session', () => {
    it('→ 200 {success:true, data:{loggedOut:true}} y el estado pasa a logged-out', async () => {
      const res = await fetch(`${BASE}/api/session`, { method: 'DELETE', headers: AUTH });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { loggedOut: true } });
      const status = await (await fetch(`${BASE}/api/status`, { headers: AUTH })).json() as { data: { status: string } };
      expect(status.data.status).toBe('logged-out');
    });
  });
});

// ─── Webhook ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'mv-webhook-secret';

interface Received {
  headers: Headers;
  raw: string;
  json: { event: string; instanceId: string; timestamp: string; data: Record<string, unknown> };
}

/**
 * Réplica del zod de maria-vendor (`route.ts:26-45`). Devuelve los errores en vez de lanzar para
 * que el fallo diga qué campo se ha roto.
 */
function validarComoMariaVendor(payload: Received['json']): string[] {
  const errors: string[] = [];
  if (typeof payload.event !== 'string') errors.push('event');
  if (typeof payload.instanceId !== 'string') errors.push('instanceId');
  if (typeof payload.timestamp !== 'string' || Number.isNaN(Date.parse(payload.timestamp))) errors.push('timestamp');
  const d = payload.data;
  if (typeof d !== 'object' || d === null) return [...errors, 'data'];
  if (typeof d.id !== 'string') errors.push('data.id');
  if (typeof d.from !== 'string') errors.push('data.from');
  if (typeof d.phone !== 'string') errors.push('data.phone');
  if (d.pushName !== undefined && typeof d.pushName !== 'string') errors.push('data.pushName');
  if (typeof d.isGroup !== 'boolean') errors.push('data.isGroup');
  if (d.groupId !== undefined && d.groupId !== null && typeof d.groupId !== 'string') errors.push('data.groupId');
  if (typeof d.timestamp !== 'number') errors.push('data.timestamp');
  if (typeof d.type !== 'string') errors.push('data.type');
  if (d.body !== undefined && typeof d.body !== 'string') errors.push('data.body');
  return errors;
}

function textoEntrante(overrides: Record<string, unknown> = {}) {
  return {
    key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: false, id: 'WAID-IN-1' },
    pushName: 'Ana',
    messageTimestamp: 1767225600,
    message: { conversation: 'hola, ¿tienen stock?' },
    _sessionId: INSTANCE,
    _accountId: null,
    _userId: null,
    ...overrides,
  };
}

describe('contrato maria-vendor · webhook', () => {
  const PORT = 19953;
  const received: Received[] = [];
  let server: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    server = Bun.serve({
      port: PORT,
      async fetch(req) {
        const raw = await req.text();
        received.push({ headers: req.headers, raw, json: JSON.parse(raw) });
        return new Response(null, { status: 202 });
      },
    });
  });
  afterAll(() => server.stop(true));

  function pipeline(overrides: Partial<EnvConfig> = {}) {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const dispatcher = createWebhookDispatcher(bus, baseConfig({
      webhookUrl: `http://localhost:${PORT}/api/whatsapp/webhook`,
      webhookSecret: WEBHOOK_SECRET,
      ...overrides,
    }), logger);
    router.start();
    dispatcher.start();
    return {
      bus,
      stop: () => { dispatcher.stop(); router.stop(); },
    };
  }

  async function entregas(esperadas: number, ms = 300): Promise<Received[]> {
    const limite = Date.now() + ms;
    while (received.length < esperadas && Date.now() < limite) await Bun.sleep(5);
    // Un margen extra para detectar entregas de más.
    await Bun.sleep(30);
    return received.splice(0);
  }

  it('un texto entrante llega como event "message", firmado y con la forma que valida maria-vendor', async () => {
    const p = pipeline();
    p.bus.emit('message', textoEntrante() as never);
    const [hit, ...resto] = await entregas(1);
    p.stop();

    expect(resto).toHaveLength(0);
    expect(hit).toBeDefined();
    expect(hit!.headers.get('content-type')).toContain('application/json');
    const firma = createHmac('sha256', WEBHOOK_SECRET).update(hit!.raw).digest('hex');
    expect(hit!.headers.get('x-wacore-signature')).toBe(firma);

    expect(validarComoMariaVendor(hit!.json)).toEqual([]);
    expect(hit!.json.event).toBe('message');
    expect(hit!.json.instanceId).toBe(INSTANCE);
    expect(hit!.json.data).toMatchObject({
      id: 'WAID-IN-1',
      from: '5215511111111@s.whatsapp.net',
      phone: '5215511111111',
      pushName: 'Ana',
      isGroup: false,
      groupId: null,
      timestamp: 1767225600,
      type: 'text',
      body: 'hola, ¿tienen stock?',
    });
  });

  it('sin WEBHOOK_SECRET no manda la cabecera de firma', async () => {
    const p = pipeline({ webhookSecret: undefined });
    p.bus.emit('message', textoEntrante() as never);
    const [hit] = await entregas(1);
    p.stop();
    expect(hit!.headers.get('x-wacore-signature')).toBeNull();
  });

  it('instanceId cae en WA_INSTANCE_NAME si el mensaje no trae sesión', async () => {
    const p = pipeline();
    p.bus.emit('message', textoEntrante({ _sessionId: undefined }) as never);
    const [hit] = await entregas(1);
    p.stop();
    expect(hit!.json.instanceId).toBe(INSTANCE);
  });

  it('una imagen con pie llega con el pie en body', async () => {
    const p = pipeline();
    p.bus.emit('message', textoEntrante({
      key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: false, id: 'WAID-IMG' },
      message: { imageMessage: { caption: 'este modelo', mimetype: 'image/jpeg' } },
    }) as never);
    const [hit] = await entregas(1);
    p.stop();
    expect(validarComoMariaVendor(hit!.json)).toEqual([]);
    expect(hit!.json.data).toMatchObject({ type: 'image', body: 'este modelo' });
  });

  it('un mensaje de grupo sale con isGroup:true y groupId', async () => {
    const p = pipeline();
    p.bus.emit('message', textoEntrante({
      key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: 'WAID-G', participant: '5215511111111@s.whatsapp.net' },
    }) as never);
    const [hit] = await entregas(1);
    p.stop();
    expect(hit!.json.data).toMatchObject({ isGroup: true, groupId: '120363000000000000@g.us' });
  });

  it('una reacción dice a qué mensaje se reaccionó', async () => {
    const p = pipeline();
    p.bus.emit('message', textoEntrante({
      key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: false, id: 'WAID-REACT' },
      message: { reactionMessage: { text: '👍', key: { id: 'WAID-TARGET', fromMe: true, remoteJid: '5215511111111@s.whatsapp.net' } } },
    }) as never);
    const [hit] = await entregas(1);
    p.stop();
    expect(hit!.json.event).toBe('message');
    expect(hit!.json.data).toMatchObject({ type: 'reaction', body: '👍' });
    expect(hit!.json.data.extras).toMatchObject({ targetId: 'WAID-TARGET', targetFromMe: true });
  });

  it('los mensajes propios no salen por el webhook', async () => {
    const p = pipeline();
    p.bus.emit('message', textoEntrante({
      key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: true, id: 'WAID-MINE' },
    }) as never);
    const hits = await entregas(0);
    p.stop();
    expect(hits).toHaveLength(0);
  });

  /**
   * Una edición conserva el `id` del mensaje original. Si saliera como `message`, maria-vendor la
   * procesaría como un mensaje nuevo del cliente y el agente contestaría dos veces. Solo se
   * entrega a quien la pide con `WEBHOOK_EVENTS=...,message.edit`.
   */
  it('con WEBHOOK_EVENTS=message las ediciones entrantes no se entregan', async () => {
    const p = pipeline();
    p.bus.emit('message', textoEntrante({
      key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: false, id: 'WAID-EDIT-ENVELOPE' },
      message: {
        protocolMessage: {
          type: 14,
          key: { id: 'WAID-IN-1', remoteJid: '5215511111111@s.whatsapp.net' },
          editedMessage: { conversation: 'hola, ¿tienen stock en rojo?' },
        },
      },
    }) as never);
    const hits = await entregas(0);
    p.stop();
    expect(hits).toHaveLength(0);
  });

  it('con WEBHOOK_EVENTS=message,message.edit la edición llega como event "message.edit"', async () => {
    const p = pipeline({ webhookEvents: ['message', 'message.edit'] });
    p.bus.emit('message', textoEntrante({
      key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: false, id: 'WAID-EDIT-ENVELOPE' },
      message: {
        protocolMessage: {
          type: 14,
          key: { id: 'WAID-IN-1', remoteJid: '5215511111111@s.whatsapp.net' },
          editedMessage: { conversation: 'hola, ¿tienen stock en rojo?' },
        },
      },
    }) as never);
    const [hit, ...resto] = await entregas(1);
    p.stop();
    expect(resto).toHaveLength(0);
    expect(hit!.json.event).toBe('message.edit');
    expect(hit!.json.data).toMatchObject({ id: 'WAID-IN-1', body: 'hola, ¿tienen stock en rojo?', isEdit: true });
  });

  it('con WEBHOOK_EVENTS=message no se entregan connection, qr, presence, message.status ni media', async () => {
    const p = pipeline();
    p.bus.emit('connection.update', { status: 'connected' } as never);
    p.bus.emit('qr', { qr: 'x', timeout: 1 } as never);
    p.bus.emit('presence.contact', { jid: '5215511111111@s.whatsapp.net', presence: 'composing' } as never);
    p.bus.emit('message.status', { messageId: 'x', status: 3 } as never);
    p.bus.emit('media.downloaded', { mediaId: 'x' } as never);
    const hits = await entregas(0);
    p.stop();
    expect(hits).toHaveLength(0);
  });

  it('con WEBHOOK_EVENTS=message no se entregan llamadas ni histórico', async () => {
    const p = pipeline();
    p.bus.emit('call', { id: 'CALL1', chatId: '5215511111111@s.whatsapp.net', from: '5215511111111@s.whatsapp.net', isGroup: false, isVideo: false, status: 'offer', timestamp: 1, offline: false } as never);
    p.bus.emit('history.message', textoEntrante({ key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: false, id: 'WAID-OLD' } }) as never);
    p.bus.emit('history.synced', { sessionId: INSTANCE, total: 1 } as never);
    const hits = await entregas(0);
    p.stop();
    expect(hits).toHaveLength(0);
  });

  it('las llamadas llegan como event "call" si se pide', async () => {
    const p = pipeline({ webhookEvents: ['message', 'call'] });
    p.bus.emit('call', { id: 'CALL1', chatId: '5215511111111@s.whatsapp.net', from: '5215511111111@s.whatsapp.net', isGroup: false, isVideo: true, status: 'offer', timestamp: 1, offline: false } as never);
    const [hit, ...resto] = await entregas(1);
    p.stop();
    expect(resto).toHaveLength(0);
    expect(hit!.json.event).toBe('call');
    expect(hit!.json.data).toMatchObject({ id: 'CALL1', status: 'offer', isVideo: true });
  });

  it('el histórico llega como "message.history" y "history.synced", nunca como "message"', async () => {
    const p = pipeline({ webhookEvents: ['message', 'history'] });
    p.bus.emit('history.message', textoEntrante({ key: { remoteJid: '5215511111111@s.whatsapp.net', fromMe: false, id: 'WAID-OLD' } }) as never);
    p.bus.emit('history.synced', { sessionId: INSTANCE, total: 1 } as never);
    const hits = await entregas(2);
    p.stop();
    expect(hits.map(h => h.json.event).sort()).toEqual(['history.synced', 'message.history']);
    const msg = hits.find(h => h.json.event === 'message.history')!;
    expect(msg.json.data).toMatchObject({ id: 'WAID-OLD', type: 'text' });
  });

  it('"escribiendo…" del cliente llega como event "presence" si se pide', async () => {
    const p = pipeline({ webhookEvents: ['message', 'presence'] });
    p.bus.emit('presence.contact', {
      sessionId: INSTANCE, chatJid: '5215511111111@s.whatsapp.net', jid: '5215511111111@s.whatsapp.net',
      phone: '5215511111111', presence: 'composing', lastSeen: null,
    } as never);
    const [hit] = await entregas(1);
    p.stop();
    expect(hit!.json.event).toBe('presence');
    expect(hit!.json.data).toMatchObject({ phone: '5215511111111', presence: 'composing' });
  });
});

// ─── Health ─────────────────────────────────────────────────────────────────

describe('contrato maria-vendor · /health', () => {
  const PORT = 19954;
  const health = createHealthMonitor(PORT, logger, INSTANCE);
  beforeAll(() => health.start());
  afterAll(() => health.stop());

  it('responde 200 aunque esté desconectado (el healthcheck es `curl -f`)', async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    expect(res.status).toBe(200);
  });

  it('devuelve status, connection, phoneNumber, uptimeSeconds y reconnections', async () => {
    health.updateConnection('connected', '5215599999999');
    const body = await (await fetch(`http://localhost:${PORT}/health`)).json() as Record<string, unknown>;
    expect(body.status).toBe('healthy');
    expect(body.connection).toBe('connected');
    expect(body.phoneNumber).toBe('5215599999999');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(typeof body.reconnections).toBe('number');
  });
});

// ─── Configuración por omisión ──────────────────────────────────────────────

/** El entorno exacto con el que maria-vendor levanta WACore (docker-compose.prod.yml). */
const MARIA_VENDOR_ENV: Record<string, string> = {
  WA_INSTANCE_NAME: 'maria',
  API_KEY: 'change-me',
  SESSION_STORE: 'postgres',
  DATABASE_URL: 'postgresql://u:p@db:5432/wacore',
  WEBHOOK_URL: 'http://app:3000/api/whatsapp/webhook',
  WEBHOOK_EVENTS: 'message',
  WEBHOOK_RETRY_COUNT: '3',
  WEBHOOK_RETRY_DELAY: '5000',
  SSE_ENABLED: 'true',
  LOG_LEVEL: 'error',
};

/** Variables que maria-vendor **no** define y cuyo valor por omisión forma parte del contrato. */
const NO_DEFINIDAS = [
  'LEGACY_SESSION_ENABLED', 'POLLING_ENABLED', 'CONNECT_ON_STARTUP',
  'WEBHOOK_SECRET', 'AUTO_READ', 'WACORE_PUBLISH_FROM_ME', 'WACORE_INTERACTIVE_MESSAGES',
  'AUTO_REJECT_CALLS', 'REDIS_URL',
];

function conEntorno<T>(env: Record<string, string>, fn: () => T): T {
  const antes = { ...process.env };
  for (const k of NO_DEFINIDAS) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
    Object.assign(process.env, antes);
  }
}

describe('contrato maria-vendor · configuración por omisión', () => {
  const config = conEntorno(MARIA_VENDOR_ENV, () => loadConfig());

  it('una sola instancia llamada como WA_INSTANCE_NAME', () => {
    expect(config.instanceName).toBe('maria');
  });

  it('arranca la sesión sin dueño si el registro está vacío', () => {
    expect(config.legacySessionEnabled).toBe(true);
  });

  it('el polling sigue activo por omisión', () => {
    expect(config.pollingEnabled).toBe(true);
  });

  it('conecta al arrancar', () => {
    expect(config.connectOnStartup).toBe(true);
  });

  it('webhook solo con el evento message', () => {
    expect(config.webhookEvents).toEqual(['message']);
  });

  it('no publica los mensajes propios, ni interactivos, ni rechaza llamadas', () => {
    expect(config.publishFromMe).toBe(false);
    expect(config.interactiveMessages).toBe(false);
    expect(config.autoRejectCalls).toBe(false);
  });

  it('LEGACY_SESSION_ENABLED=false sigue permitiendo apagar la sesión sin dueño', () => {
    const c = conEntorno({ ...MARIA_VENDOR_ENV, LEGACY_SESSION_ENABLED: 'false' }, () => loadConfig());
    expect(c.legacySessionEnabled).toBe(false);
  });

  it('POLLING_ENABLED=false sigue permitiendo apagar el polling', () => {
    const c = conEntorno({ ...MARIA_VENDOR_ENV, POLLING_ENABLED: 'false' }, () => loadConfig());
    expect(c.pollingEnabled).toBe(false);
  });
});

// ─── Arranque de la sesión ──────────────────────────────────────────────────

describe('contrato maria-vendor · arranque con Postgres', () => {
  const contactStore = {
    upsert: async () => {}, upsertMany: async () => {}, list: async () => ({ items: [], total: 0 }),
    setProfilePic: async () => {}, mergeLid: async () => {}, purgeSession: async () => {},
  } as unknown as ContactStore;
  const labelStore = {
    upsertLabel: async () => {}, listLabels: async () => [], getLabel: async () => null,
    addAssociation: async () => {}, removeAssociation: async () => {},
    getAssociations: async () => ({ chats: [], messages: [] }),
  } as unknown as LabelStore;

  function registroVacio(filasCreadas: string[]): PostgresSessionRegistry {
    return {
      list: async () => [],
      ensureRow: async (id: string) => { filasCreadas.push(id); },
      updateStatus: async () => {},
      deleteRow: async () => {},
    } as unknown as PostgresSessionRegistry;
  }

  /**
   * Base nueva, o un `DELETE /api/session` seguido de un reinicio: el registro está vacío. Con la
   * configuración de maria-vendor tiene que nacer la sesión `maria`; si no, todas las rutas
   * responden 404 y no hay forma de volver a pedir el QR.
   */
  it('con el registro vacío crea la sesión WA_INSTANCE_NAME y las rutas la encuentran', async () => {
    const env = conEntorno(MARIA_VENDOR_ENV, () => loadConfig());
    const filas: string[] = [];
    const sm = createSessionManager({
      config: { ...env, sessionStore: 'file', sessionDir: mkdtempSync(join(tmpdir(), 'wacore-mv-')), connectOnStartup: false },
      globalEventBus: createEventBus(),
      contactStore,
      labelStore,
      logger,
      registry: registroVacio(filas),
    });

    await sm.bootstrap();

    expect(filas).toEqual(['maria']);
    expect(sm.getOrLegacy().sessionId).toBe('maria');
    await sm.stopAll();
  });
});

// ─── Migraciones ────────────────────────────────────────────────────────────

describe('contrato maria-vendor · migraciones', () => {
  /**
   * `created_at` de la migración 0000 tal y como quedó grabado en las bases que desplegó
   * WACore v0.3.2 (la de maria-vendor, entre ellas).
   */
  const WHEN_0000_V032 = 1778271577956;
  const journal = JSON.parse(readFileSync(join(import.meta.dir, '../../../migrations/meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; when: number; tag: string }>;
  };

  it('la 0000 conserva el `when` con el que se aplicó en v0.3.2', () => {
    expect(journal.entries[0]).toMatchObject({ tag: '0000_nappy_matthew_murdock', when: WHEN_0000_V032 });
  });

  /**
   * Drizzle solo aplica las migraciones con `when` mayor que el último `created_at` guardado. Una
   * migración con un `when` menor se salta **en silencio** en una base de v0.3.2.
   */
  it('todas las migraciones posteriores tienen un `when` estrictamente creciente y mayor que el de la 0000', () => {
    for (let i = 1; i < journal.entries.length; i++) {
      const prev = journal.entries[i - 1]!;
      const cur = journal.entries[i]!;
      expect({ tag: cur.tag, mayor: cur.when > prev.when }).toEqual({ tag: cur.tag, mayor: true });
    }
  });
});
