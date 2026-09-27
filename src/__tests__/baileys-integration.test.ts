import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createMessageRouter } from '../core/message-router';
import { createHealthMonitor } from '../core/health';
import { createMessageSender } from '../services/message-sender';
import { createLogger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from '../storage/session-store';

const testConfig: EnvConfig = {
  instanceName: 'integration-test',
  healthPort: 19877,
  apiPort: 19878,
  logLevel: 'error',
  sessionStore: 'file',
  sessionDir: '/tmp/wacore-int-test',
  webhookEvents: ['message'],
  webhookRetryCount: 1,
  webhookRetryDelay: 10,
  webhookUrl: 'http://localhost:28999/webhook',
  webhookSecret: 'int-test-secret',
  connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
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

/** Las opciones con las que el cliente construyó el socket. Sirve para mirar el adaptador de log. */
let opcionesDelSocket: any = null;

function simulateBaileysEvent(event: string, ...args: any[]) {
  const list = currentSocketHandlers?.get(event) ?? [];
  for (const handler of list) {
    handler(...args);
  }
}

function resetSocketHandlers() {
  currentSocketHandlers = new Map();
}

function createMockSocketFactory() {
  resetSocketHandlers();

  return (opts?: any) => ({
    ev: {
      on(event: string, handler: (...args: any[]) => void) {
        opcionesDelSocket = opts ?? opcionesDelSocket;
        const list = currentSocketHandlers.get(event) ?? [];
        list.push(handler);
        currentSocketHandlers.set(event, list);
      },
    },
    user: null as { id: string } | null,
    sendMessage: mock(async () => ({ key: { id: 'msg-integration' } })),
    ws: { close: mock(() => {}) },
    logout: mock(async () => {}),
  });
}

mock.module('baileys', () => ({
  makeWASocket: createMockSocketFactory(),
  // El cliente la llama al arrancar para resolver la versión de WhatsApp Web. Sin ella en el
  // doble, bun no encuentra la exportación y **aborta el fichero entero** antes de la primera
  // prueba, con un SyntaxError que no señala a este sitio.
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
  DisconnectReason: {},
  useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
  isLidUser: (jid?: string) => !!jid?.endsWith('@lid'),
  jidNormalizedUser: (jid: string) => {
    const atIdx = jid.indexOf('@');
    if (atIdx < 0) return jid;
    const userPart = (jid.slice(0, atIdx).split(':')[0] ?? '').split('_')[0];
    const server = jid.slice(atIdx + 1);
    return `${userPart}@${server === 'c.us' ? 's.whatsapp.net' : server}`;
  },
}));

describe('Baileys Integration - Message Pipeline', () => {
  afterEach(() => {
    resetSocketHandlers();
  });

  it('flows raw text message through client → eventBus → router → typed event', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const typedHandler = mock();
    bus.on('message.text', typedHandler);
    router.start();

    const rawMessage = {
      key: { remoteJid: '5215551234567@s.whatsapp.net', id: 'msg-001', fromMe: false },
      message: { conversation: 'Hello from integration test' },
      messageTimestamp: Date.now() / 1000,
      pushName: 'TestUser',
    };

    bus.emit('message', rawMessage as any);

    expect(typedHandler).toHaveBeenCalledTimes(1);
    const normalized = typedHandler.mock.calls[0]?.[0];
    expect(normalized.type).toBe('text');
    expect(normalized.body).toBe('Hello from integration test');
    expect(normalized.phone).toBe('5215551234567');
    expect(normalized.from).toBe('5215551234567@s.whatsapp.net');
    expect(normalized.pushName).toBe('TestUser');

    router.stop();
    await client.stop();
  });

  it('routes image, video, audio, document through correct events', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const imageHandler = mock();
    const videoHandler = mock();
    const audioHandler = mock();
    const docHandler = mock();
    bus.on('message.image', imageHandler);
    bus.on('message.video', videoHandler);
    bus.on('message.audio', audioHandler);
    bus.on('message.document', docHandler);
    router.start();

    const mediaTypes = [
      { type: 'image' as const, msg: { imageMessage: { mimetype: 'image/jpeg', caption: 'pic' } }, handler: imageHandler },
      { type: 'video' as const, msg: { videoMessage: { mimetype: 'video/mp4', caption: 'vid' } }, handler: videoHandler },
      { type: 'audio' as const, msg: { audioMessage: { mimetype: 'audio/ogg' } }, handler: audioHandler },
      { type: 'document' as const, msg: { documentMessage: { mimetype: 'application/pdf', fileName: 'doc.pdf' } }, handler: docHandler },
    ];

    for (const mt of mediaTypes) {
      bus.emit('message', {
        key: { remoteJid: '5215551234567@s.whatsapp.net', id: `msg-${mt.type}`, fromMe: false },
        message: mt.msg,
        messageTimestamp: Date.now() / 1000,
        pushName: 'User',
      } as any);

      expect(mt.handler).toHaveBeenCalledTimes(1);
      const msg = mt.handler.mock.calls[0]?.[0];
      expect(msg.type).toBe(mt.type);
    }

    router.stop();
    await client.stop();
  });

  it('handles group messages with groupId', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.text', handler);
    router.start();

    bus.emit('message', {
      key: { remoteJid: '1234567890@g.us', id: 'msg-group-1', fromMe: false },
      message: { conversation: 'Group message' },
      messageTimestamp: Date.now() / 1000,
      pushName: 'GroupUser',
    } as any);

    const msg = handler.mock.calls[0]?.[0];
    expect(msg.isGroup).toBe(true);
    expect(msg.groupId).toBe('1234567890@g.us');

    router.stop();
    await client.stop();
  });

  it('handles reaction messages through the pipeline', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.reaction', handler);
    router.start();

    bus.emit('message', {
      key: { remoteJid: '5215551234567@s.whatsapp.net', id: 'msg-react-1', fromMe: false },
      message: { reactionMessage: { text: '👍', key: { id: 'orig-msg' } } },
      messageTimestamp: Date.now() / 1000,
      pushName: 'Reactor',
    } as any);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0].type).toBe('reaction');
    expect(handler.mock.calls[0]?.[0].body).toBe('👍');

    router.stop();
    await client.stop();
  });

  it('ignores unknown message types gracefully', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message', handler);
    router.start();

    bus.emit('message', {
      key: { remoteJid: '5215551234567@s.whatsapp.net', id: 'msg-unknown', fromMe: false },
      message: { weirdCustomField: {} },
      messageTimestamp: Date.now() / 1000,
      pushName: 'Unknown',
    } as any);

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0]?.[0];
    expect(msg.key?.id).toBe('msg-unknown');

    router.stop();
    await client.stop();
  });
});

describe('Baileys Integration - Client + Auth + Session Store', () => {
  afterEach(() => {
    resetSocketHandlers();
  });

  it('creates client with disconnected status', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);

    expect(client.getConnectionStatus()).toBe('disconnected');
  });

  it('starts and transitions to connecting', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);

    await client.start();
    expect(client.getConnectionStatus()).toBe('connecting');

    await client.stop();
    expect(client.getConnectionStatus()).toBe('disconnected');
  });

  it('loads existing session from store on auth provider creation', async () => {
    const { createAuthProvider } = await import('../baileys/auth');
    const store = createMockSessionStore();
    await store.save({ registrationId: 42 }, { preKeys: [1, 2, 3] });

    const authProvider = await createAuthProvider(store, logger);

    expect(store.load).toHaveBeenCalled();
    expect(authProvider.state.creds).toEqual({ registrationId: 42 });
    const allKeys = await authProvider.state.keys.get('', []);
    expect(allKeys).toEqual({ preKeys: [1, 2, 3] });
  });

  it('generates fresh creds when no session exists', async () => {
    const { createAuthProvider } = await import('../baileys/auth');
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);

    expect(authProvider.state.creds.registrationId).toBeDefined();
    expect(authProvider.state.creds.noiseKey).toBeDefined();
    const allKeys = await authProvider.state.keys.get('', []);
    expect(allKeys).toEqual({});
  });

  it('saves creds to store on demand', async () => {
    const { createAuthProvider } = await import('../baileys/auth');
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);

    authProvider.state.creds = { registrationId: 99 };
    await authProvider.saveCreds();

    expect(store.save).toHaveBeenCalledWith({ registrationId: 99 }, {});
  });

  it('coalesces rapid saveCreds calls to at most one follow-up write', async () => {
    // Ver auth.test.ts para el racional: coalescing, no descarte.
    const { createAuthProvider } = await import('../baileys/auth');
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);

    authProvider.saveCreds();
    authProvider.saveCreds();
    authProvider.saveCreds();
    await authProvider.saveCreds();

    const calls = (store.save as any).mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('emits qr event and updates status via bus', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const qrHandler = mock();
    bus.on('qr', qrHandler);

    bus.emit('qr', { qr: 'test-qr-data', timeout: testConfig.qrTimeout });

    expect(qrHandler).toHaveBeenCalledTimes(1);
    expect(qrHandler.mock.calls[0]?.[0].qr).toBe('test-qr-data');

    await client.stop();
  });

  it('handles creds.update event flow', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    authProvider.state.creds = { registrationId: 77 };

    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    await authProvider.saveCreds();
    expect(store.save).toHaveBeenCalledWith({ registrationId: 77 }, {});

    await client.stop();
  });
});

describe('Baileys Integration - Message Sending', () => {
  afterEach(() => {
    resetSocketHandlers();
  });

  it('sends text message with jid auto-suffix', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);

    await client.start();

    const sender = createMessageSender(client, bus, logger);
    const messageId = await sender.sendText('5215551234567', 'Integration test');

    expect(messageId).toBe('msg-integration');
    const sockSend = (client.socket as any).sendMessage;
    expect(sockSend).toHaveBeenCalledWith(
      '5215551234567@s.whatsapp.net',
      { text: 'Integration test' },
    );

    await client.stop();
  });

  it('preserves existing @ in jid', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const sender = createMessageSender(client, bus, logger);
    await sender.sendText('5215551234567@s.whatsapp.net', 'Hi');

    const sockSend = (client.socket as any).sendMessage;
    expect(sockSend).toHaveBeenCalledWith(
      '5215551234567@s.whatsapp.net',
      { text: 'Hi' },
    );

    await client.stop();
  });

  it('sends all media types through the pipeline', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const sender = createMessageSender(client, bus, logger);
    const sockSend = (client.socket as any).sendMessage;

    const imageId = await sender.sendMedia({
      to: '5215551234567', type: 'image', url: 'https://example.com/img.jpg',
      caption: 'Test', mimetype: 'image/jpeg',
    });
    expect(imageId).toBe('msg-integration');
    expect(sockSend).toHaveBeenCalledWith('5215551234567@s.whatsapp.net', {
      image: { url: 'https://example.com/img.jpg' }, caption: 'Test', mimetype: 'image/jpeg',
    });

    const videoId = await sender.sendMedia({
      to: '5215551234567', type: 'video', url: 'https://example.com/vid.mp4',
    });
    expect(videoId).toBe('msg-integration');

    const docId = await sender.sendMedia({
      to: '5215551234567', type: 'document', url: 'https://example.com/doc.pdf',
      filename: 'doc.pdf',
    });
    expect(docId).toBe('msg-integration');

    const audioId = await sender.sendMedia({
      to: '5215551234567', type: 'audio', url: 'https://example.com/audio.ogg',
    });
    expect(audioId).toBe('msg-integration');

    expect(sockSend).toHaveBeenCalledTimes(4);

    await client.stop();
  });

  it('throws on unsupported media type', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const sender = createMessageSender(client, bus, logger);

    await expect(sender.sendMedia({
      to: '5215551234567', type: 'unknown' as any,
      url: 'https://example.com/file',
    })).rejects.toThrow('Unsupported media type: unknown');

    await client.stop();
  });
});

describe('Baileys Integration - Health Monitor', () => {
  afterEach(() => {
    resetSocketHandlers();
  });

  it('reports disconnected initially', async () => {
    const health = createHealthMonitor(testConfig.healthPort, logger, testConfig.instanceName);
    const status = health.getStatus();
    expect(status.status).toBe('unhealthy');
    expect(status.connection).toBe('disconnected');
  });

  it('transitions through connection states', async () => {
    const health = createHealthMonitor(testConfig.healthPort, logger, testConfig.instanceName);
    health.start();

    health.updateConnection('connecting');
    expect(health.getStatus().status).toBe('degraded');

    health.updateConnection('connected', '5215551234567');
    expect(health.getStatus().status).toBe('healthy');
    expect(health.getStatus().connection).toBe('connected');

    health.updateConnection('disconnected');
    expect(health.getStatus().status).toBe('unhealthy');

    health.stop();
  });

  it('tracks reconnection count', async () => {
    const health = createHealthMonitor(testConfig.healthPort, logger, testConfig.instanceName);

    expect(health.getStatus().reconnections).toBe(0);
    health.incrementReconnections();
    expect(health.getStatus().reconnections).toBe(1);
    health.incrementReconnections();
    expect(health.getStatus().reconnections).toBe(2);
  });

  it('tracks uptime', async () => {
    const health = createHealthMonitor(testConfig.healthPort, logger, testConfig.instanceName);
    const status = health.getStatus();
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('serves HTTP health endpoint', async () => {
    const health = createHealthMonitor(19977, logger, testConfig.instanceName);
    health.start();

    health.updateConnection('connected', '5215551234567');

    const res = await fetch('http://localhost:19977/health');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe('healthy');
    expect(body.connection).toBe('connected');

    health.stop();
  });

  it('exposes phoneNumber in health endpoint (contrato v0.3.2)', async () => {
    const health = createHealthMonitor(19978, logger, testConfig.instanceName);
    health.start();

    health.updateConnection('connected', '5215551234567');

    const res = await fetch('http://localhost:19978/health');
    const body = await res.json() as Record<string, unknown>;
    expect(body.phoneNumber).toBe('5215551234567');

    health.stop();
  });

  it('returns 404 for unknown routes', async () => {
    const health = createHealthMonitor(19979, logger, testConfig.instanceName);
    health.start();

    const res = await fetch('http://localhost:19979/not-health');
    expect(res.status).toBe(404);

    health.stop();
  });
});

describe('Baileys Integration - Message Router Edge Cases', () => {
  afterEach(() => {
    resetSocketHandlers();
  });

  it('extracts quoted message from extendedTextMessage', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.text', handler);
    router.start();

    bus.emit('message', {
      key: { remoteJid: '5215551234567@s.whatsapp.net', id: 'msg-quoted', fromMe: false },
      message: {
        extendedTextMessage: {
          text: 'Reply to quoted',
          contextInfo: {
            stanzaId: 'orig-msg-1',
            participant: '5215551234567@s.whatsapp.net',
            quotedMessage: { conversation: 'Original message' },
          },
        },
      },
      messageTimestamp: Date.now() / 1000,
      pushName: 'Replier',
    } as any);

    const msg = handler.mock.calls[0]?.[0];
    expect(msg.body).toBe('Reply to quoted');
    expect(msg.quotedMessage).not.toBeNull();
    expect(msg.quotedMessage?.id).toBe('orig-msg-1');
    expect(msg.quotedMessage?.from).toBe('5215551234567@s.whatsapp.net');

    router.stop();
    await client.stop();
  });

  it('extracts phone from jid correctly', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.text', handler);
    router.start();

    const testCases = [
      { jid: '5215551234567@s.whatsapp.net', expected: '5215551234567' },
      { jid: '1234567890@g.us', expected: '1234567890' },
    ];

    for (const tc of testCases) {
      bus.emit('message', {
        key: { remoteJid: tc.jid, id: 'msg-phone-test', fromMe: false },
        message: { conversation: 'Phone test' },
        messageTimestamp: Date.now() / 1000,
        pushName: 'User',
      } as any);

      const msg = handler.mock.calls[handler.mock.calls.length - 1]?.[0];
      expect(msg.phone).toBe(tc.expected);
    }

    router.stop();
    await client.stop();
  });
});

/**
 * Un código QR que nadie escanea no puede tener a una línea reintentando para siempre.
 *
 * Baileys agota los códigos (`QR refs attempts ended`), cierra con `timedOut` —que sí es un
 * motivo reintentable— y vuelve a empezar. En dev se vio el intento 74, con 1.767 eventos `qr`
 * atascados que no le importaban a nadie.
 *
 * Y la otra mitad, que es la que no se puede romper: una sesión **con** credenciales reintenta
 * igual que siempre. Rendirse ahí fue lo que dejó una línea pidiendo QR por un corte de DNS de
 * tres minutos, con las credenciales intactas.
 */
describe('Baileys — el QR sin escanear se rinde, la sesión emparejada no', () => {
  const cierrePorTiempo = {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode: 408 } } },
  };

  function almacenConCredenciales(): SessionStore {
    const datos = {
      creds: { registered: true, me: { id: '34600000000:1@s.whatsapp.net' } },
      keys: {},
    };
    return {
      save: mock(async () => {}),
      load: mock(async () => datos),
      delete: mock(async () => {}),
      exists: mock(async () => true),
      backup: mock(async () => {}),
    } as unknown as SessionStore;
  }

  afterEach(() => {
    resetSocketHandlers();
  });

  it('sin emparejar, agotadas las rondas se queda en disconnected y deja de reintentar', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');

    const cfg = { ...testConfig, qrMaxRounds: 2 };
    const bus = createEventBus();
    const store = createMockSessionStore();   // load() → null: nunca se emparejó
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(cfg, bus, authProvider, store, logger);
    await client.start();

    const estados: string[] = [];
    bus.on('connection.update', (u: any) => estados.push(u.status));

    simulateBaileysEvent('connection.update', cierrePorTiempo);
    expect(estados.at(-1)).toBe('connecting');

    simulateBaileysEvent('connection.update', cierrePorTiempo);
    expect(estados.at(-1)).toBe('disconnected');

    await client.stop();
  });

  /**
   * Que otro cliente nos eche no puede convertirse en una guerra de reconexiones.
   *
   * `connectionReplaced` (440) significa que alguien más tomó la sesión: otra pestaña de WhatsApp
   * Web, otra herramienta, otro servidor con estas credenciales. Estaba clasificado como una caída
   * de red, así que se reconectaba siempre — y como cada conexión efímera reiniciaba el contador de
   * reintentos, la pelea no terminaba nunca: varias reconexiones **por segundo**, machacando a
   * WhatsApp (motivo habitual de bloqueo de un número) y dejando la línea parpadeando en el consumidor
   * entre «Conectada» y «Generando código».
   */
  it('si otro cliente nos echa varias veces, se deja de pelear por la sesión', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');

    const bus = createEventBus();
    const store = almacenConCredenciales();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const estados: string[] = [];
    bus.on('connection.update', (u: any) => estados.push(u.status));

    const reemplazada = {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 440 } } },
    };

    // Gana la sesión y se la quitan, tres veces seguidas. Ninguna conexión aguanta.
    for (let i = 0; i < 3; i++) {
      simulateBaileysEvent('connection.update', { connection: 'open' });
      simulateBaileysEvent('connection.update', reemplazada);
    }

    expect(estados.at(-1)).toBe('disconnected');

    await client.stop();
  });

  it('un reemplazo suelto no tumba la línea', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');

    const bus = createEventBus();
    const store = almacenConCredenciales();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const estados: string[] = [];
    bus.on('connection.update', (u: any) => estados.push(u.status));

    // Alguien abrió WhatsApp Web un momento y lo cerró: se reintenta, como siempre.
    simulateBaileysEvent('connection.update', { connection: 'open' });
    simulateBaileysEvent('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 440 } } },
    });

    expect(estados.at(-1)).not.toBe('disconnected');

    await client.stop();
  });

  it('emparejada, sigue reintentando por muchas veces que se caiga', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');

    const cfg = { ...testConfig, qrMaxRounds: 1 };
    const bus = createEventBus();
    const store = almacenConCredenciales();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(cfg, bus, authProvider, store, logger);
    await client.start();

    const avisos: string[] = [];
    const warnOriginal = logger.warn.bind(logger);
    (logger as { warn: (m: string, c?: Record<string, unknown>) => void }).warn = (m, c) => {
      avisos.push(m);
      warnOriginal(m, c);
    };

    try {
      for (let i = 0; i < 4; i++) simulateBaileysEvent('connection.update', cierrePorTiempo);
    } finally {
      (logger as { warn: (m: string, c?: Record<string, unknown>) => void }).warn = warnOriginal;
    }

    // Con `qrMaxRounds: 1`, una sesión sin credenciales se habría rendido en el primer cierre.
    expect(avisos).not.toContain('QR abandonado: nadie lo escaneó, la sesión deja de reintentar');

    await client.stop();
  });
});

/**
 * El puente entre el log de Baileys y el nuestro.
 *
 * Baileys habla pino, y pino pone el objeto primero y el texto después. El adaptador se quedaba
 * solo con el primer argumento, así que en producción los avisos salían así:
 *
 *     {"levelName":"warn","msg":"{\"msgId\":\"31120.38820-210\"}","source":"baileys"}
 *
 * El texto que faltaba era `timed out waiting for message`, y era la única pista de que WhatsApp
 * llevaba horas sin contestar a las consultas del catálogo. Un aviso mudo es peor que ninguno:
 * ocupa sitio en el log y no dice nada.
 */
describe('El adaptador de log de Baileys', () => {
  it('conserva el texto del mensaje, no solo el objeto', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();

    const escrito: string[] = [];
    const espia = { ...logger, warn: (msg: string) => { escrito.push(msg); } };
    const puente = opcionesDelSocket?.logger;

    expect(puente).toBeDefined();

    // Se llama al puente como lo llama Baileys: objeto delante, texto detrás.
    const original = (logger as any).warn;
    (logger as any).warn = espia.warn;
    try {
      puente.warn({ msgId: '31120.38820-210' }, 'timed out waiting for message');
    } finally {
      (logger as any).warn = original;
    }

    expect(escrito).toHaveLength(1);
    expect(escrito[0]).toContain('timed out waiting for message');
    expect(escrito[0]).toContain('31120.38820-210');
  });

  it('un mensaje suelto, sin objeto, sale tal cual', async () => {
    const puente = opcionesDelSocket?.logger;
    const escrito: string[] = [];
    const original = (logger as any).info;
    (logger as any).info = (msg: string) => { escrito.push(msg); };
    try {
      puente.info('WhatsApp connected');
    } finally {
      (logger as any).info = original;
    }

    expect(escrito).toEqual(['WhatsApp connected']);
  });
});

/**
 * Rearrancar una línea a la que WhatsApp le ha cerrado la sesión.
 *
 * Un `401 loggedOut` significa que la sesión ya no existe al otro lado, y volver a intentarlo con
 * las mismas credenciales no puede funcionar. Peor: **impide que se pida un código**, porque
 * Baileys solo emite el evento `qr` cuando el estado de autenticación viene vacío. La línea se
 * quedaba en un bucle de `logging in…` → `401` que `whatsapp:check-sessions` relanzaba cada cinco
 * minutos, sin QR y sin salida; la única cura era reiniciar WACore entero.
 *
 * La limpieza existía, pero solo en `connect()`. Las sesiones se rearrancan por `start()` —es lo
 * que llama `sessionManager.create()` al encontrar una línea caída en el pool—, así que por ese
 * camino no se limpiaba nunca.
 */
describe('rearranque de una sesión cerrada por WhatsApp', () => {
  it('start() tira las credenciales muertas para que vuelva a haber QR', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);

    let reseteos = 0;
    const resetOriginal = authProvider.reset;
    authProvider.reset = () => { reseteos++; resetOriginal(); };

    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();
    expect(reseteos).toBe(0);

    simulateBaileysEvent('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    expect(client.getConnectionStatus()).toBe('logged-out');

    // Exactamente lo que hace `sessionManager.create()` con una línea caída del pool.
    await client.start();
    expect(reseteos).toBe(1);

    await client.stop();
  });

  it('no las tira si la línea solo estaba caída, no cerrada', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);

    let reseteos = 0;
    const resetOriginal = authProvider.reset;
    authProvider.reset = () => { reseteos++; resetOriginal(); };

    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);
    await client.start();
    await client.stop();

    // `stop()` deja la sesión en `disconnected`. Sus credenciales siguen valiendo: tirarlas aquí
    // obligaría a reescanear un QR por un reinicio del contenedor.
    await client.start();
    expect(reseteos).toBe(0);

    await client.stop();
  });

  /**
   * `start()` se llama más de una vez sobre el mismo cliente, y cada llamada creaba un
   * `setInterval` sin retirar el anterior. Con `whatsapp:check-sessions` pidiéndolo cada cinco
   * minutos, las subidas de pre-claves se multiplicaban solas.
   */
  it('start() no deja vivo el temporizador de la vez anterior', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, store, logger);

    const setOriginal = globalThis.setInterval;
    const clearOriginal = globalThis.clearInterval;
    const creados: unknown[] = [];
    const limpiados: unknown[] = [];

    globalThis.setInterval = ((fn: any, ms: any) => {
      const id = setOriginal(fn, ms);
      creados.push(id);
      return id;
    }) as typeof globalThis.setInterval;
    globalThis.clearInterval = ((id: any) => {
      limpiados.push(id);
      return clearOriginal(id);
    }) as typeof globalThis.clearInterval;

    try {
      await client.start();
      await client.start();

      expect(creados).toHaveLength(2);
      expect(limpiados).toContain(creados[0]);
    } finally {
      await client.stop();
      globalThis.setInterval = setOriginal;
      globalThis.clearInterval = clearOriginal;
    }
  });
});
