import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { InMemoryContactStore } from '../storage/contact-store';
import { createEventBus } from '../core/event-bus';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';

const mockConfig = {
  instanceName: 'test-contacts',
  healthPort: 9890,
  apiPort: 9891,
  logLevel: 'error' as const,
  sessionStore: 'file' as const,
  sessionDir: '/tmp',
  webhookEvents: [],
  webhookRetryCount: 0,
  webhookRetryDelay: 0,
  connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false,
  sseEnabled: false,
  messageBufferSize: 1000,
  messageBufferTtlMs: 300000,
  sseHeartbeatMs: 30000,
  nodeEnv: 'test',
  autoTyping: false,
  typingDurationMs: 3000,
  autoRead: false,
  apiKey: 'testkey',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9891',
};

const logger = createLogger(mockConfig);

const AUTH = { Authorization: 'Bearer testkey' };

/** Lo que hace el cliente cuando le piden resincronizar la agenda. Cada test lo ajusta. */
const estadoCliente: {
  status: string;
  resyncs: number;
  resync: () => Promise<{ total: number; inAddressBook: number; addressBookSynced: boolean; skippedRecords: number }>;
} = {
  status: 'connected',
  resyncs: 0,
  resync: async () => ({ total: 3, inAddressBook: 2, addressBookSynced: true, skippedRecords: 0 }),
};

function createMockSession(): ManagedSession {
  return {
    sessionId: 'test',
    accountId: null,
    userId: null,
    client: {
      socket: null,
      getConnectionStatus: () => estadoCliente.status as any,
      getQr: () => null,
      getContacts: () => [],
      resyncContacts: async () => { estadoCliente.resyncs++; return estadoCliente.resync(); },
      connect: async () => {}, start: async () => {}, stop: async () => {}, logout: async () => {}, sendMessage: async () => ({}), sendPresenceUpdate: async () => {}, readMessages: async () => {}, uploadPreKeysToServerIfRequired: async () => {},
    } as any,
    messageSender: { sendText: async () => 'id', sendMedia: async () => 'id', sendSticker: async () => 'id', sendLocation: async () => 'id', sendContact: async () => 'id', sendPtt: async () => 'id', sendList: async () => 'id', sendButtons: async () => 'id', revoke: async () => {}, react: async () => {}, forward: async () => [] } as any,
    presenceManager: { setPresence: async () => {}, startTyping: () => {}, stopTyping: () => {}, sendWithTyping: async <T>(_j: string, fn: () => Promise<T>) => fn(), stop: () => {} },
    readReceiptManager: { sendReadReceipt: async () => {}, start: () => {}, stop: () => {} },
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

function createMockSessionManager(): SessionManager {
  const s = createMockSession();
  return { bootstrap: async () => {}, get: () => s, getOrLegacy: () => s, create: async () => s, destroy: async () => {}, list: () => [s.getInfo()], stopAll: async () => {} };
}

describe('REST API — contact endpoints', () => {
  let store: InMemoryContactStore;
  let api: ReturnType<typeof createRestApi>;

  beforeAll(async () => {
    store = new InMemoryContactStore();
    await store.upsertMany('test', [
      { jid: '1@s.whatsapp.net', phone: '34111', bookName: 'Alice', inAddressBook: true },
      { jid: '2@s.whatsapp.net', phone: '34222', pushName: 'Bob' },
      { jid: '3@s.whatsapp.net', phone: '34333', bookName: 'Carlos', inAddressBook: true, profilePicUrl: 'https://pic.url' },
      { jid: '4@g.us', bookName: 'Work Group', isGroup: true },
      // Un LID sin traducir: está en la agenda pero no hay número al que importarlo.
      { jid: '777@lid', lid: '777@lid', bookName: 'Sin número', inAddressBook: true },
    ]);
    // La agenda de otra línea del mismo servicio. No debe asomar por ninguna ruta.
    await store.upsertMany('otra-empresa:9', [
      { jid: '5@s.whatsapp.net', phone: '34555', bookName: 'Cliente de otra empresa', inAddressBook: true },
    ]);

    api = createRestApi(
      9891,
      mockConfig,
      logger,
      createMockSessionManager(),
      undefined,
      undefined,
      undefined,
      store,
    );
    api.start();
  });

  afterAll(() => {
    api.stop();
  });

  describe('GET /api/contacts', () => {
    it('returns all non-group contacts with pagination metadata', async () => {
      const res = await fetch('http://localhost:9891/api/contacts', { headers: AUTH });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.data.total).toBe(4);
      expect(body.data.contacts.length).toBe(4);
      expect(body.data.limit).toBe(100);
      expect(body.data.offset).toBe(0);
    });

    it('includes avatar field on each contact', async () => {
      const res = await fetch('http://localhost:9891/api/contacts', { headers: AUTH });
      const body = await res.json() as any;
      const alice = body.data.contacts.find((c: any) => c.name === 'Alice');
      expect(alice).toBeDefined();
      expect('avatar' in alice).toBe(true);
    });

    it('filters by onlyMyContacts=true', async () => {
      const res = await fetch('http://localhost:9891/api/contacts?onlyMyContacts=true', { headers: AUTH });
      const body = await res.json() as any;
      expect(body.data.total).toBe(3);
      expect(body.data.contacts.every((c: any) => c.isMyContact)).toBe(true);
    });

    it('searches by name', async () => {
      const res = await fetch('http://localhost:9891/api/contacts?q=alice', { headers: AUTH });
      const body = await res.json() as any;
      expect(body.data.total).toBe(1);
      expect(body.data.contacts[0].name).toBe('Alice');
    });

    it('searches by phone', async () => {
      const res = await fetch('http://localhost:9891/api/contacts?q=34222', { headers: AUTH });
      const body = await res.json() as any;
      expect(body.data.total).toBe(1);
      expect(body.data.contacts[0].phone).toBe('34222');
    });

    it('paginates with limit and offset', async () => {
      const res = await fetch('http://localhost:9891/api/contacts?limit=1&offset=1', { headers: AUTH });
      const body = await res.json() as any;
      expect(body.data.contacts.length).toBe(1);
      expect(body.data.total).toBe(4);
      expect(body.data.limit).toBe(1);
      expect(body.data.offset).toBe(1);
    });

    it('includes groups when includeGroups=true', async () => {
      const res = await fetch('http://localhost:9891/api/contacts?includeGroups=true', { headers: AUTH });
      const body = await res.json() as any;
      expect(body.data.total).toBe(5);
    });

    it('returns 401 without auth', async () => {
      const res = await fetch('http://localhost:9891/api/contacts');
      expect(res.status).toBe(401);
    });

    it('no devuelve la agenda de otra línea', async () => {
      const res = await fetch('http://localhost:9891/api/contacts?limit=500', { headers: AUTH });
      const body = await res.json() as any;
      const nombres = body.data.contacts.map((c: any) => c.name);
      expect(nombres).not.toContain('Cliente de otra empresa');
    });

    it('un contacto solo conocido por su LID sale sin teléfono y con su LID', async () => {
      const res = await fetch('http://localhost:9891/api/contacts?q=sin', { headers: AUTH });
      const body = await res.json() as any;
      expect(body.data.contacts[0]).toMatchObject({ phone: null, lid: '777@lid', inAddressBook: true, isMyContact: true });
    });
  });

  describe('POST /api/contacts/resync', () => {
    it('resincroniza y devuelve cuántos contactos tiene la agenda', async () => {
      estadoCliente.status = 'connected';
      estadoCliente.resyncs = 0;
      estadoCliente.resync = async () => ({ total: 3, inAddressBook: 2, addressBookSynced: true, skippedRecords: 0 });

      const res = await fetch('http://localhost:9891/api/contacts/resync', { method: 'POST', headers: AUTH });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true, data: { total: 3, inAddressBook: 2, addressBookSynced: true, skippedRecords: 0 } });
      expect(estadoCliente.resyncs).toBe(1);
    });

    it('409 si la línea no está conectada, sin pedir nada a WhatsApp', async () => {
      estadoCliente.status = 'awaiting-qr';
      estadoCliente.resyncs = 0;

      const res = await fetch('http://localhost:9891/api/contacts/resync', { method: 'POST', headers: AUTH });

      expect(res.status).toBe(409);
      expect(estadoCliente.resyncs).toBe(0);
      estadoCliente.status = 'connected';
    });

    it('500 si el resync falla', async () => {
      estadoCliente.resync = async () => { throw new Error('WhatsApp no contestó'); };

      const res = await fetch('http://localhost:9891/api/contacts/resync', { method: 'POST', headers: AUTH });

      expect(res.status).toBe(500);
      expect(((await res.json()) as any).error).toContain('WhatsApp no contestó');
      estadoCliente.resync = async () => ({ total: 3, inAddressBook: 2, addressBookSynced: true, skippedRecords: 0 });
    });

    it('dice cuándo WhatsApp no entregó la agenda, sin disfrazarlo de agenda vacía', async () => {
      estadoCliente.resync = async () => ({ total: 0, inAddressBook: 0, addressBookSynced: false, skippedRecords: 0 });

      const res = await fetch('http://localhost:9891/api/contacts/resync', { method: 'POST', headers: AUTH });
      const body = await res.json() as any;

      expect(res.status).toBe(200);
      expect(body.data.addressBookSynced).toBe(false);
      estadoCliente.resync = async () => ({ total: 3, inAddressBook: 2, addressBookSynced: true, skippedRecords: 0 });
    });

    it('401 sin autenticar', async () => {
      const res = await fetch('http://localhost:9891/api/contacts/resync', { method: 'POST' });
      expect(res.status).toBe(401);
    });
  });
});
