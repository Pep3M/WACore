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
  nodeEnv: 'test',
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

  return () => ({
    ev: {
      on(event: string, handler: (...args: any[]) => void) {
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
  DisconnectReason: {},
  useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);

    expect(client.getConnectionStatus()).toBe('disconnected');
  });

  it('starts and transitions to connecting', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);

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

  it('debounces rapid saveCreds calls', async () => {
    const { createAuthProvider } = await import('../baileys/auth');
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);

    authProvider.saveCreds();
    authProvider.saveCreds();
    authProvider.saveCreds();
    await Bun.sleep(0);

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('emits qr event and updates status via bus', async () => {
    const { createBaileysClient } = await import('../baileys/client');
    const { createAuthProvider } = await import('../baileys/auth');
    const bus = createEventBus();
    const store = createMockSessionStore();
    const authProvider = await createAuthProvider(store, logger);
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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

    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);

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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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

  it('hides phoneNumber by default in health endpoint', async () => {
    const health = createHealthMonitor(19978, logger, testConfig.instanceName);
    health.start();

    health.updateConnection('connected', '5215551234567');

    const res = await fetch('http://localhost:19978/health');
    const body = await res.json() as Record<string, unknown>;
    expect(body.phoneNumber).toBeUndefined();

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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
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
    const client = await createBaileysClient(testConfig, bus, authProvider, logger);
    await client.start();

    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.text', handler);
    router.start();

    const testCases = [
      { jid: '5215551234567@s.whatsapp.net', expected: '5215551234567' },
      { jid: '1234567890@g.us', expected: '1234567890' },
      { jid: 'test@broadcast', expected: 'test' },
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
