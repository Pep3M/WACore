import { describe, expect, it, mock, afterEach } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createMessageRouter } from '../core/message-router';
import { createLogger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from '../storage/session-store';

/**
 * Volcado del histórico al emparejar una línea.
 *
 * Hasta ahora `messaging-history.set` se quedaba solo con los contactos y tiraba los mensajes,
 * así que la bandeja del consumidor nacía vacía por muchos meses de conversaciones que trajera
 * WhatsApp. Lo que se protege aquí es tanto que lleguen como que **no lleguen de golpe**: el
 * evento `message` alimenta al descargador de adjuntos y a los consumidores, y meter ahí diez
 * mil mensajes de hace meses sería peor que no importarlos.
 */

const testConfig: EnvConfig = {
  instanceName: 'history-test',
  healthPort: 19977,
  apiPort: 19978,
  logLevel: 'error',
  sessionStore: 'file',
  sessionDir: '/tmp/wacore-history-test',
  webhookEvents: [],
  webhookRetryCount: 0,
  webhookRetryDelay: 0,
  connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000,
  sseHeartbeatMs: 30000,
  autoTyping: false, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
  historyBatchDelayMs: 5,
};

const logger = createLogger(testConfig);

function createMockSessionStore(): SessionStore {
  let data: { creds: unknown; keys: unknown } | null = null;
  return {
    save: mock(async (creds: unknown, keys: unknown) => { data = { creds, keys }; }),
    load: mock(async () => data),
    delete: mock(async () => { data = null; }),
    exists: mock(async () => data !== null),
    backup: mock(async () => {}),
  };
}

let currentSocketHandlers: Map<string, Array<(...args: any[]) => void>>;

function simulate(event: string, ...args: any[]): void {
  for (const handler of currentSocketHandlers?.get(event) ?? []) handler(...args);
}

function createMockSocketFactory() {
  currentSocketHandlers = new Map();
  return () => ({
    ev: {
      on(event: string, handler: (...args: any[]) => void) {
        const list = currentSocketHandlers.get(event) ?? [];
        list.push(handler);
        currentSocketHandlers.set(event, list);
      },
    },
    user: null as { id: string } | null,
    sendMessage: mock(async () => ({ key: { id: 'x' } })),
    ws: { close: mock(() => {}) },
    logout: mock(async () => {}),
  });
}

mock.module('baileys', () => ({
  makeWASocket: createMockSocketFactory(),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
  DisconnectReason: {},
  useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
  isLidUser: (jid?: string) => !!jid?.endsWith('@lid'),
  jidNormalizedUser: (jid: string) => jid,
}));

function mensajeHistorico(i: number, overrides: Record<string, any> = {}): any {
  return {
    key: { remoteJid: `5215551234${String(i).padStart(3, '0')}@s.whatsapp.net`, id: `hist-${i}`, fromMe: false },
    message: { conversation: `mensaje viejo ${i}` },
    messageTimestamp: 1700000000 + i,
    pushName: 'Cliente',
    ...overrides,
  };
}

async function clienteListo(config: EnvConfig = testConfig) {
  currentSocketHandlers = new Map();
  const { createBaileysClient } = await import('../baileys/client');
  const { createAuthProvider } = await import('../baileys/auth');
  const bus = createEventBus();
  const store = createMockSessionStore();
  const authProvider = await createAuthProvider(store, logger);
  const client = await createBaileysClient(config, bus, authProvider, store, logger);
  await client.start();
  return { bus, client };
}

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Histórico — qué sale del cliente', () => {
  afterEach(() => { currentSocketHandlers = new Map(); });

  it('los mensajes del volcado se emiten, ya no se tiran', async () => {
    const { bus, client } = await clienteListo();
    const historicos = mock();
    bus.on('history.message', historicos);

    simulate('messaging-history.set', { contacts: [], messages: [mensajeHistorico(1), mensajeHistorico(2)] });
    await esperar(60);

    expect(historicos).toHaveBeenCalledTimes(2);
    await client.stop();
  });

  it('no salen por el evento `message`', async () => {
    const { bus, client } = await clienteListo();
    const enVivo = mock();
    bus.on('message', enVivo);

    simulate('messaging-history.set', { contacts: [], messages: [mensajeHistorico(1)] });
    await esperar(60);

    // Ese evento alimenta al descargador de adjuntos, a los consumidores y a la caché global: meter ahí
    // el histórico pondría a bajar miles de archivos y a contestar conversaciones de hace meses.
    expect(enVivo).not.toHaveBeenCalled();
    await client.stop();
  });

  it('sale a goteo, en lotes', async () => {
    const config = { ...testConfig, historyBatchSize: 2, historyBatchDelayMs: 40 };
    const { bus, client } = await clienteListo(config);
    const historicos = mock();
    bus.on('history.message', historicos);

    simulate('messaging-history.set', {
      contacts: [],
      messages: [1, 2, 3, 4, 5, 6].map(i => mensajeHistorico(i)),
    });

    // Tras el primer lote solo pueden haber salido dos: el resto espera su turno.
    await esperar(10);
    expect(historicos).toHaveBeenCalledTimes(2);

    await esperar(200);
    expect(historicos).toHaveBeenCalledTimes(6);
    await client.stop();
  });

  it('el tope corta el volcado en lugar de dejarlo entero', async () => {
    const config = { ...testConfig, historyMax: 3, historyBatchSize: 10, historyBatchDelayMs: 1 };
    const { bus, client } = await clienteListo(config);
    const historicos = mock();
    bus.on('history.message', historicos);

    simulate('messaging-history.set', {
      contacts: [],
      messages: [1, 2, 3, 4, 5].map(i => mensajeHistorico(i)),
    });
    await esperar(60);

    expect(historicos).toHaveBeenCalledTimes(3);
    await client.stop();
  });

  it('el tope cuenta entre tandas, no por tanda', async () => {
    const config = { ...testConfig, historyMax: 3, historyBatchSize: 10, historyBatchDelayMs: 1 };
    const { bus, client } = await clienteListo(config);
    const historicos = mock();
    bus.on('history.message', historicos);

    // WhatsApp entrega el histórico en varias tandas: un tope por tanda no sería un tope.
    simulate('messaging-history.set', { contacts: [], messages: [mensajeHistorico(1), mensajeHistorico(2)] });
    await esperar(40);
    simulate('messaging-history.set', { contacts: [], messages: [mensajeHistorico(3), mensajeHistorico(4)] });
    await esperar(60);

    expect(historicos).toHaveBeenCalledTimes(3);
    await client.stop();
  });

  it('un mensaje sin clave no se emite', async () => {
    const { bus, client } = await clienteListo();
    const historicos = mock();
    bus.on('history.message', historicos);

    simulate('messaging-history.set', {
      contacts: [],
      messages: [
        { message: { conversation: 'sin clave' } },
        { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: 'sin id' } },
        mensajeHistorico(1),
      ],
    });
    await esperar(60);

    // Sin identidad el consumidor no puede evitar duplicarlo al reimportar.
    expect(historicos).toHaveBeenCalledTimes(1);
    await client.stop();
  });

  it('con la sincronización apagada no sale nada', async () => {
    const { bus, client } = await clienteListo({ ...testConfig, historySyncEnabled: false });
    const historicos = mock();
    bus.on('history.message', historicos);

    simulate('messaging-history.set', { contacts: [], messages: [mensajeHistorico(1)] });
    await esperar(60);

    expect(historicos).not.toHaveBeenCalled();
    await client.stop();
  });

  it('los contactos se siguen guardando', async () => {
    const { client } = await clienteListo();

    // Lo que ya funcionaba no se toca: esta fase añade los mensajes, no cambia los contactos.
    expect(() =>
      simulate('messaging-history.set', {
        contacts: [{ id: '5215551234567@s.whatsapp.net', notify: 'Ana' }],
        messages: [mensajeHistorico(1)],
      }),
    ).not.toThrow();

    await client.stop();
  });

  it('avisa una sola vez de que ha terminado, no por tanda', async () => {
    // El aviso espera a que dejen de llegar tandas: `historyBatchDelayMs * 8`, con suelo de 250 ms.
    const config = { ...testConfig, historyBatchSize: 10, historyBatchDelayMs: 5 };
    const { bus, client } = await clienteListo(config);
    const fin = mock();
    bus.on('history.synced', fin);

    simulate('messaging-history.set', { contacts: [], messages: [mensajeHistorico(1)] });
    await esperar(20);
    simulate('messaging-history.set', { contacts: [], messages: [mensajeHistorico(2)] });

    // Un «ya está» por tanda sería mentira: WhatsApp sigue mandando.
    await esperar(600);

    expect(fin).toHaveBeenCalledTimes(1);
    expect(fin.mock.calls[0]?.[0].count).toBe(2);
    await client.stop();
  });
});

describe('Histórico — cómo se normaliza', () => {
  afterEach(() => { currentSocketHandlers = new Map(); });

  it('sale por `message.history`, no por los eventos de siempre', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const historico = mock();
    const texto = mock();
    bus.on('message.history', historico);
    bus.on('message.text', texto);
    router.start();

    bus.emit('history.message', mensajeHistorico(1) as any);

    expect(historico).toHaveBeenCalledTimes(1);
    expect(texto).not.toHaveBeenCalled();
    expect(historico.mock.calls[0]?.[0].body).toBe('mensaje viejo 1');
  });

  it('se normaliza igual que un mensaje en vivo', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const historico = mock();
    const vivo = mock();
    bus.on('message.history', historico);
    bus.on('message.text', vivo);
    router.start();

    const crudo = mensajeHistorico(7);
    bus.emit('message', { ...crudo } as any);
    bus.emit('history.message', { ...crudo } as any);

    // Dos normalizadores para lo mismo dejarían el histórico y lo nuevo con formas distintas
    // dentro de la misma conversación. Por eso el normalizador es uno solo.
    expect(historico.mock.calls[0]?.[0]).toEqual(vivo.mock.calls[0]?.[0]);
  });

  it('el histórico trae lo propio aunque los mensajes propios estén apagados', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger, { publishFromMe: false });
    const historico = mock();
    bus.on('message.history', historico);
    router.start();

    bus.emit('history.message', mensajeHistorico(1, {
      key: { remoteJid: '5215551234567@s.whatsapp.net', id: 'hist-mio', fromMe: true },
    }) as any);

    // Esa bandera existe para que el eco de un envío no duplique lo que el consumidor ya guardó. En un
    // volcado no hay nada guardado, así que respetarla dejaría media conversación importada.
    expect(historico).toHaveBeenCalledTimes(1);
    expect(historico.mock.calls[0]?.[0].fromMe).toBe(true);
  });

  it('un mensaje del histórico que no se puede leer no rompe el resto', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const historico = mock();
    bus.on('message.history', historico);
    router.start();

    bus.emit('history.message', { key: { remoteJid: 'x@s.whatsapp.net', id: 'raro' }, message: { loQueSea: {} } } as any);
    bus.emit('history.message', mensajeHistorico(1) as any);

    expect(historico).toHaveBeenCalledTimes(1);
  });
});
