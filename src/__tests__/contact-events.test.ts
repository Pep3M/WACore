import { describe, expect, it, mock, afterEach } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';
import { InMemoryContactStore } from '../storage/contact-store';
import { InMemoryLabelStore } from '../storage/label-store';
import type { EnvConfig } from '../types';
import type { SessionStore } from '../storage/session-store';

/**
 * Qué se guarda en la agenda de una línea a partir de los eventos de Baileys.
 *
 * Tres fallos que hacían que la agenda importada al consumidor no fuera la del teléfono:
 *
 * - la marca de «guardado» estaba al revés: se ponía con el pushName (`notify`) y no con el nombre
 *   de agenda (`name`), y cada mensaje entrante la quitaba;
 * - un contacto conocido por su LID se guardaba con los dígitos del LID como si fueran su número;
 * - la agenda era una para todo el servicio, y cada línea recibía la de las demás.
 */

const testConfig: EnvConfig = {
  instanceName: 'contact-events-test',
  healthPort: 19987,
  apiPort: 19988,
  logLevel: 'error',
  sessionStore: 'file',
  sessionDir: '/tmp/wacore-contact-events-test',
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
};

const logger = createLogger(testConfig);

const LINEA = 'cuenta-a:1';
const OTRA_LINEA = 'cuenta-b:2';

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

/** Traducciones LID → teléfono que conoce el repositorio de señal de la línea. */
const LID_A_TELEFONO: Record<string, string> = {};

interface SocketFalso {
  manejadores: Map<string, Array<(...args: any[]) => void>>;
  authState: { keys: { set: ReturnType<typeof mock>; get: ReturnType<typeof mock> } };
  resyncAppState: ReturnType<typeof mock>;
  [clave: string]: unknown;
}

let ultimoSocket: SocketFalso;

function crearFabricaSocket() {
  return () => {
    const manejadores = new Map<string, Array<(...args: any[]) => void>>();
    const socket: SocketFalso = {
      manejadores,
      ev: {
        on(evento: string, handler: (...args: any[]) => void) {
          const lista = manejadores.get(evento) ?? [];
          lista.push(handler);
          manejadores.set(evento, lista);
        },
      },
      user: null,
      sendMessage: mock(async () => ({ key: { id: 'x' } })),
      signalRepository: { lidMapping: { getPNForLID: async (lid: string) => LID_A_TELEFONO[lid] ?? null } },
      authState: {
        keys: {
          set: mock(async () => {}),
          // Tras un resync que sale bien, Baileys deja guardada la versión de la colección.
          get: mock(async () => ({ critical_unblock_low: { version: 3 } })),
        },
      },
      resyncAppState: mock(async () => {}),
      ws: { close: mock(() => {}) },
      logout: mock(async () => {}),
    };
    ultimoSocket = socket;
    return socket;
  };
}

mock.module('baileys', () => ({
  makeWASocket: crearFabricaSocket(),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
  DisconnectReason: {},
  useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
  isLidUser: (jid?: string) => !!jid?.endsWith('@lid'),
  jidNormalizedUser: (jid: string) => jid,
}));

function simular(socket: SocketFalso, evento: string, ...args: any[]): void {
  for (const h of socket.manejadores.get(evento) ?? []) h(...args);
}

const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

async function clienteListo(store = new InMemoryContactStore(), sessionId = LINEA) {
  const { createBaileysClient } = await import('../baileys/client');
  const { createAuthProvider } = await import('../baileys/auth');
  const sessionStore = createMockSessionStore();
  const authProvider = await createAuthProvider(sessionStore, logger);
  const client = await createBaileysClient(
    testConfig,
    createEventBus(),
    authProvider,
    sessionStore,
    logger,
    store,
    new InMemoryLabelStore(),
    sessionId,
  );
  await client.start();
  return { client, store, socket: ultimoSocket };
}

afterEach(() => {
  for (const clave of Object.keys(LID_A_TELEFONO)) delete LID_A_TELEFONO[clave];
});

describe('agenda — qué se guarda de cada evento', () => {
  it('un contacto de la agenda del teléfono queda guardado y marcado como tal', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [{ id: '34600111222@s.whatsapp.net', name: 'Amy Iglesia' }]);
    await esperar(30);

    const [amy] = (await store.list(LINEA)).items;
    expect(amy).toMatchObject({
      jid: '34600111222@s.whatsapp.net',
      phone: '34600111222',
      name: 'Amy Iglesia',
      inAddressBook: true,
      isMyContact: true,
    });
  });

  it('el pushName no convierte a nadie en contacto de la agenda', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'messaging-history.set', {
      contacts: [{ id: '34600999888@s.whatsapp.net', notify: 'Un desconocido' }],
      messages: [],
    });
    await esperar(30);

    const [c] = (await store.list(LINEA)).items;
    expect(c).toMatchObject({ name: 'Un desconocido', pushName: 'Un desconocido', inAddressBook: false, isMyContact: false });
    expect((await store.list(LINEA, { onlyMyContacts: true })).total).toBe(0);
  });

  it('el nombre de usuario que Baileys pone en `name` no cuenta como agenda', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [{ id: '34600111222@s.whatsapp.net', name: 'amy.iglesia', username: 'amy.iglesia' }]);
    await esperar(30);

    expect((await store.list(LINEA)).items[0]!.inAddressBook).toBe(false);
  });

  it('un @lid que trae su phoneNumber se guarda con el teléfono real', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [{
      id: '211617400811648@lid',
      name: 'Amy Iglesia',
      phoneNumber: '34600111222@s.whatsapp.net',
    }]);
    await esperar(30);

    const [amy] = (await store.list(LINEA)).items;
    expect(amy).toMatchObject({
      jid: '34600111222@s.whatsapp.net',
      phone: '34600111222',
      lid: '211617400811648@lid',
      inAddressBook: true,
    });
  });

  it('un @lid sin phoneNumber se traduce con el mapeo de la línea', async () => {
    LID_A_TELEFONO['211617400811648@lid'] = '34600111222:3@s.whatsapp.net';
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [{ id: '211617400811648@lid', name: 'Amy Iglesia' }]);
    await esperar(30);

    expect((await store.list(LINEA)).items[0]).toMatchObject({
      jid: '34600111222@s.whatsapp.net',
      phone: '34600111222',
    });
  });

  it('un @lid que no se puede traducir queda sin teléfono, no con los dígitos del LID', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [{ id: '211617400811648@lid', name: 'Sin número' }]);
    await esperar(30);

    expect((await store.list(LINEA)).items[0]).toMatchObject({
      jid: '211617400811648@lid',
      phone: null,
      lid: '211617400811648@lid',
      inAddressBook: true,
    });
  });

  it('un mensaje entrante no saca al contacto de la agenda ni le cambia el nombre', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [{ id: '34600111222@s.whatsapp.net', name: 'Amy Iglesia' }]);
    await esperar(30);
    simular(socket, 'messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: '34600111222@s.whatsapp.net', id: 'm1', fromMe: false },
        message: { conversation: 'hola' },
        pushName: 'amy 🌸',
      }],
    });
    await esperar(30);

    const [amy] = (await store.list(LINEA)).items;
    expect(amy).toMatchObject({ name: 'Amy Iglesia', pushName: 'amy 🌸', inAddressBook: true });
  });

  it('quien escribe desde un LID ya traducido se une a la fila de su teléfono', async () => {
    LID_A_TELEFONO['211617400811648@lid'] = '34600111222@s.whatsapp.net';
    const { store, socket } = await clienteListo();

    simular(socket, 'messages.upsert', {
      type: 'notify',
      messages: [{
        key: { remoteJid: '211617400811648@lid', id: 'm1', fromMe: false },
        message: { conversation: 'hola' },
        pushName: 'Amy',
      }],
    });
    await esperar(30);

    const { items, total } = await store.list(LINEA);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ phone: '34600111222', lid: '211617400811648@lid', pushName: 'Amy', inAddressBook: false });
  });

  it('lid-mapping.update funde la fila del LID con la del teléfono', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [{ id: '211617400811648@lid', name: 'Amy Iglesia' }]);
    await esperar(30);
    simular(socket, 'lid-mapping.update', { lid: '211617400811648@lid', pn: '34600111222@s.whatsapp.net' });
    await esperar(30);

    const { items, total } = await store.list(LINEA);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ jid: '34600111222@s.whatsapp.net', phone: '34600111222', name: 'Amy Iglesia', inAddressBook: true });
  });

  it('grupos y canales no son contactos de la agenda; las difusiones ni se guardan', async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.upsert', [
      { id: '120363041234567890@g.us', name: 'Familia' },
      { id: '120363999999999999@newsletter', name: 'Un canal' },
      { id: 'status@broadcast', name: 'Estados' },
    ]);
    await esperar(30);

    const todos = await store.list(LINEA, { includeGroups: true });
    expect(todos.items.map(c => c.name).sort()).toEqual(['Familia', 'Un canal']);
    expect(todos.items.every(c => !c.inAddressBook)).toBe(true);
    expect(todos.items.find(c => c.name === 'Familia')!.isGroup).toBe(true);
  });

  it("imgUrl 'changed' no se guarda como si fuera la foto", async () => {
    const { store, socket } = await clienteListo();

    simular(socket, 'contacts.update', [{ id: '34600111222@s.whatsapp.net', imgUrl: 'changed' }]);
    simular(socket, 'contacts.update', [{ id: '34600111333@s.whatsapp.net', imgUrl: 'https://pps.whatsapp.net/foto.jpg' }]);
    await esperar(30);

    const porTelefono = Object.fromEntries((await store.list(LINEA)).items.map(c => [c.phone, c.avatar]));
    expect(porTelefono['34600111222']).toBeNull();
    expect(porTelefono['34600111333']).toBe('https://pps.whatsapp.net/foto.jpg');
  });

  it('dos líneas que comparten almacén guardan cada una su agenda', async () => {
    const store = new InMemoryContactStore();
    const una = await clienteListo(store, LINEA);
    const otra = await clienteListo(store, OTRA_LINEA);

    simular(una.socket, 'contacts.upsert', [{ id: '34600111222@s.whatsapp.net', name: 'Amy Iglesia' }]);
    simular(otra.socket, 'contacts.upsert', [{ id: '34699999999@s.whatsapp.net', name: 'Cliente de otra empresa' }]);
    await esperar(30);

    expect((await store.list(LINEA)).items.map(c => c.name)).toEqual(['Amy Iglesia']);
    expect((await store.list(OTRA_LINEA)).items.map(c => c.name)).toEqual(['Cliente de otra empresa']);
  });
});

describe('resyncContacts', () => {
  it('pide la agenda entera a WhatsApp y contesta cuando ya está guardada', async () => {
    const { client, store, socket } = await clienteListo();
    simular(socket, 'connection.update', { connection: 'open' });

    // Como Baileys: los eventos del resync salen un poco después de que termine la llamada.
    socket.resyncAppState = mock(async () => {
      setTimeout(() => simular(socket, 'contacts.upsert', [
        { id: '34600000001@s.whatsapp.net', name: 'Uno' },
        { id: '34600000002@s.whatsapp.net', name: 'Dos' },
        { id: '34600000003@s.whatsapp.net', notify: 'Tres' },
      ]), 100);
    });

    const resultado = await client.resyncContacts();

    expect(socket.authState.keys.set).toHaveBeenCalledWith({ 'app-state-sync-version': { critical_unblock_low: null } });
    expect(socket.resyncAppState).toHaveBeenCalledWith(['critical_unblock_low'], true);
    expect(resultado).toEqual({ total: 3, inAddressBook: 2, addressBookSynced: true, skippedRecords: 0 });
    expect((await store.list(LINEA)).total).toBe(3);
  });

  /**
   * Baileys reintenta el snapshot y **se rinde sin lanzar**. Sin mirar si quedó guardada la
   * versión de la colección, un fallo de lectura se contaba como «esta agenda está vacía», y el
   * consumidor decía «0 contactos importados» a quien sí tiene agenda.
   */
  it('avisa de que WhatsApp no entregó la agenda en vez de contestar cero', async () => {
    const { client, socket } = await clienteListo();
    simular(socket, 'connection.update', { connection: 'open' });
    socket.authState.keys.get = mock(async () => ({}));

    const resultado = await client.resyncContacts();

    expect(resultado).toMatchObject({ total: 0, inAddressBook: 0, addressBookSynced: false });
  });

  it('cuenta los registros del snapshot que no se pudieron leer', async () => {
    const { client, socket } = await clienteListo();
    simular(socket, 'connection.update', { connection: 'open' });
    // Lo que hace el parche de Baileys al saltarse un registro ilegible.
    socket.resyncAppState = mock(async () => {
      (globalThis as any).__wacoreAppStateSkipped = ((globalThis as any).__wacoreAppStateSkipped ?? 0) + 2;
    });

    const resultado = await client.resyncContacts();

    expect(resultado.skippedRecords).toBe(2);
    expect(resultado.addressBookSynced).toBe(true);
  });

  it('dos peticiones a la vez hacen un solo resync', async () => {
    const { client, socket } = await clienteListo();
    simular(socket, 'connection.update', { connection: 'open' });

    const [a, b] = await Promise.all([client.resyncContacts(), client.resyncContacts()]);

    expect(socket.resyncAppState).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it('falla si la línea no está conectada, sin tocar el estado de WhatsApp', async () => {
    const { client, socket } = await clienteListo();

    await expect(client.resyncContacts()).rejects.toThrow('no está conectada');
    expect(socket.authState.keys.set).not.toHaveBeenCalled();
  });
});

describe('cerrar sesión', () => {
  it('borra la agenda de esa línea y deja la de las demás', async () => {
    const store = new InMemoryContactStore();
    const una = await clienteListo(store, LINEA);
    const otra = await clienteListo(store, OTRA_LINEA);

    simular(una.socket, 'contacts.upsert', [{ id: '34600111222@s.whatsapp.net', name: 'Amy Iglesia' }]);
    simular(otra.socket, 'contacts.upsert', [{ id: '34699999999@s.whatsapp.net', name: 'Otro' }]);
    await esperar(30);

    await una.client.logout();
    await esperar(30);

    expect((await store.list(LINEA)).total).toBe(0);
    expect((await store.list(OTRA_LINEA)).total).toBe(1);
  });
});
