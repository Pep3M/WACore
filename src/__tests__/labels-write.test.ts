import { describe, expect, it, mock, afterAll } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import { createLabelManager, InvalidLabelColorError } from '../services/label-manager';
import { InMemoryLabelStore } from '../storage/label-store';
import type { BaileysClient } from '../baileys/client';
import type { LabelManager } from '../services/label-manager';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';

const PORT = 19951;
const CHAT = '34600111222@s.whatsapp.net';

const mockConfig = {
  instanceName: 'test', healthPort: 19952, apiPort: PORT, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, autoRead: false, apiKey: 'k',
  mediaDir: '/tmp/media', mediaAutoDownload: false, mediaBaseUrl: `http://localhost:${PORT}`,
  labelsEnabled: true,
};
const logger = createLogger(mockConfig);

describe('LabelManager', () => {
  function crear(socket: any) {
    return createLabelManager({ socket } as unknown as BaileysClient, logger);
  }

  it('crea la etiqueta con un parche global, sin chat', async () => {
    const addLabel = mock(async () => {});
    await crear({ addLabel }).upsert({ id: 'L1', name: 'Cliente', color: 3 });
    const [jid, cuerpo] = addLabel.mock.calls[0] as any[];
    expect(jid).toBe('');
    expect(cuerpo).toEqual({ id: 'L1', name: 'Cliente', color: 3, deleted: false });
  });

  it('rechaza un color fuera de los veinte que admite WhatsApp', async () => {
    const addLabel = mock(async () => {});
    await expect(crear({ addLabel }).upsert({ id: 'L1', name: 'X', color: 20 }))
      .rejects.toBeInstanceOf(InvalidLabelColorError);
    // Lo importante no es el error, es que el parche no sale: uno mal formado
    // desincroniza el app-state de la cuenta.
    expect(addLabel).not.toHaveBeenCalled();
  });

  it('rechaza un color negativo y uno decimal', async () => {
    const addLabel = mock(async () => {});
    const m = crear({ addLabel });
    await expect(m.upsert({ id: 'L1', name: 'X', color: -1 })).rejects.toThrow();
    await expect(m.upsert({ id: 'L1', name: 'X', color: 2.5 })).rejects.toThrow();
    expect(addLabel).not.toHaveBeenCalled();
  });

  it('cuelga y descuelga la etiqueta de un chat', async () => {
    const addChatLabel = mock(async () => {});
    const removeChatLabel = mock(async () => {});
    const m = crear({ addChatLabel, removeChatLabel });
    await m.attachChat('34600111222', 'L1');
    await m.detachChat(CHAT, 'L1');
    expect((addChatLabel.mock.calls[0] as any[])[0]).toBe(CHAT);
    expect((removeChatLabel.mock.calls[0] as any[])[1]).toBe('L1');
  });

  it('cuelga la etiqueta de un mensaje concreto', async () => {
    const addMessageLabel = mock(async () => {});
    await crear({ addMessageLabel }).attachMessage(CHAT, 'MSG9', 'L1');
    expect(addMessageLabel.mock.calls[0] as unknown[]).toEqual([CHAT, 'MSG9', 'L1']);
  });

  it('revienta si la línea no está conectada', async () => {
    await expect(crear(null).attachChat(CHAT, 'L1')).rejects.toThrow('WhatsApp socket not connected');
  });
});

// ─── Rutas ──────────────────────────────────────────────────

const store = new InMemoryLabelStore();
const labelManager: LabelManager = {
  upsert: mock(async () => {}),
  attachChat: mock(async () => {}),
  detachChat: mock(async () => {}),
  attachMessage: mock(async () => {}),
  detachMessage: mock(async () => {}),
};

function sesion(): ManagedSession {
  return {
    sessionId: 'test', accountId: null, userId: null,
    client: {} as any, messageSender: {} as any,
    presenceManager: {} as any, readReceiptManager: {} as any,
    groupManager: {} as any, profileManager: {} as any, labelManager, chatManager: {} as any,
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

describe('escritura de etiquetas por HTTP', () => {
  const api = createRestApi(
    PORT, mockConfig, logger, sm,
    undefined, undefined, undefined, undefined,
    store,
  );
  api.start();
  afterAll(() => { api.stop(); });

  const base = `http://localhost:${PORT}`;
  const post = (ruta: string, body: unknown) =>
    fetch(base + ruta, { method: 'POST', headers: cab, body: JSON.stringify(body) });
  const del = (ruta: string, body?: unknown) =>
    fetch(base + ruta, { method: 'DELETE', headers: cab, body: body ? JSON.stringify(body) : undefined });

  it('la etiqueta creada aparece al listar, aunque WhatsApp no confirme nunca', async () => {
    const res = await post('/api/labels', { id: 'L1', name: 'Cliente VIP', color: 5 });
    expect(res.status).toBe(200);

    // Este es el fondo de la fase: las cuentas Business modernas no disparan `labels.edit`,
    // así que sin la escritura local el listado quedaría vacío tras un 200.
    const lista = await (await fetch(`${base}/api/labels`, { headers: cab })).json() as any;
    const l = lista.data.labels.find((x: any) => x.id === 'L1');
    expect(l).toBeDefined();
    expect(l.name).toBe('Cliente VIP');
    expect(l.source).toBe('local');
  });

  it('genera un id si no se lo dan', async () => {
    const res = await post('/api/labels', { name: 'Sin id', color: 1 });
    const json = await res.json() as any;
    expect(json.data.label.id).toBeTruthy();
  });

  it('rechaza un color fuera de rango antes de tocar WhatsApp', async () => {
    const res = await post('/api/labels', { name: 'X', color: 99 });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain('0 and 19');
  });

  it('rechaza un nombre vacío', async () => {
    expect((await post('/api/labels', { name: '  ', color: 1 })).status).toBe(400);
  });

  it('borrar es marcar deleted, y desaparece del listado', async () => {
    await post('/api/labels', { id: 'L2', name: 'Temporal', color: 2 });
    expect((await del('/api/labels/L2')).status).toBe(200);

    const lista = await (await fetch(`${base}/api/labels`, { headers: cab })).json() as any;
    expect(lista.data.labels.find((x: any) => x.id === 'L2')).toBeUndefined();

    const conBorradas = await (await fetch(`${base}/api/labels?includeDeleted=true`, { headers: cab })).json() as any;
    expect(conBorradas.data.labels.find((x: any) => x.id === 'L2').deleted).toBe(true);
  });

  it('borrar una etiqueta que no existe da 404', async () => {
    expect((await del('/api/labels/NO-EXISTE')).status).toBe(404);
  });

  it('cuelga la etiqueta de un chat y se ve en sus asociaciones', async () => {
    await post('/api/labels', { id: 'L3', name: 'Seguimiento', color: 4 });
    expect((await post('/api/labels/L3/associations', { chatJid: CHAT })).status).toBe(200);

    const asoc = await (await fetch(`${base}/api/labels/L3/associations`, { headers: cab })).json() as any;
    expect(asoc.data.chats).toContain(CHAT);
  });

  it('cuelga la etiqueta de un mensaje concreto', async () => {
    await post('/api/labels', { id: 'L4', name: 'Pendiente', color: 6 });
    await post('/api/labels/L4/associations', { chatJid: CHAT, messageId: 'MSG9' });

    const asoc = await (await fetch(`${base}/api/labels/L4/associations`, { headers: cab })).json() as any;
    expect(asoc.data.messages).toEqual([{ chatJid: CHAT, messageId: 'MSG9' }]);
    expect(labelManager.attachMessage).toHaveBeenCalled();
  });

  it('descolgar la quita', async () => {
    await post('/api/labels', { id: 'L5', name: 'Quitar', color: 7 });
    await post('/api/labels/L5/associations', { chatJid: CHAT });
    await del('/api/labels/L5/associations', { chatJid: CHAT });

    const asoc = await (await fetch(`${base}/api/labels/L5/associations`, { headers: cab })).json() as any;
    expect(asoc.data.chats).toEqual([]);
  });

  it('rechaza colgar sin chat', async () => {
    expect((await post('/api/labels/L3/associations', {})).status).toBe(400);
  });
});
