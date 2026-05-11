import { describe, expect, it, mock, spyOn, afterEach } from 'bun:test';
import { createReadReceiptManager } from '../services/read-receipt-manager';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { BaileysClient } from '../baileys/client';
import type { EnvConfig, PresenceType } from '../types';

const mockConfig: EnvConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test',
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000,
  messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000,
  autoRead: false,
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};
const logger = createLogger(mockConfig);

function createMockClient(): BaileysClient {
  return {
    socket: null,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    sendMessage: mock(async () => ({ key: { id: 'msg-1' } })),
    sendPresenceUpdate: mock(async (_jid: string, _type: PresenceType) => {}),
    readMessages: mock(async (_keys: Array<{ remoteJid: string; id: string; fromMe?: boolean; participant?: string }>) => {}),
    getConnectionStatus: mock(() => 'connected' as const),
    getQr: mock(() => null),
    logout: mock(async () => {}),
    connect: mock(async () => {}),
    getContacts: mock(() => []),
    uploadPreKeysToServerIfRequired: mock(async () => {}),
  };
}

describe('ReadReceiptManager', () => {
  afterEach(() => {
    mock.restore();
  });

  describe('sendReadReceipt', () => {
    it('sends read receipt for an individual chat (no participant)', async () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await mgr.sendReadReceipt('123456789', ['msg-id-1']);

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: '123456789@s.whatsapp.net',
          id: 'msg-id-1',
          fromMe: false,
        },
      ]);
    });

    it('sends read receipt for multiple message ids', async () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await mgr.sendReadReceipt('123456789', ['msg-1', 'msg-2', 'msg-3']);

      expect(client.readMessages).toHaveBeenCalledWith([
        { remoteJid: '123456789@s.whatsapp.net', id: 'msg-1', fromMe: false },
        { remoteJid: '123456789@s.whatsapp.net', id: 'msg-2', fromMe: false },
        { remoteJid: '123456789@s.whatsapp.net', id: 'msg-3', fromMe: false },
      ]);
    });

    it('sends read receipt for a group chat with participant', async () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await mgr.sendReadReceipt('123456789@g.us', ['msg-grp-1'], '987654321');

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: '123456789@g.us',
          id: 'msg-grp-1',
          fromMe: false,
          participant: '987654321@s.whatsapp.net',
        },
      ]);
    });

    it('normalizes JID when no @ suffix present', async () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await mgr.sendReadReceipt('521234567890', ['msg-1']);

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: '521234567890@s.whatsapp.net',
          id: 'msg-1',
          fromMe: false,
        },
      ]);
    });

    it('does not double-suffix JID when @ already present', async () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await mgr.sendReadReceipt('123456789@s.whatsapp.net', ['msg-1']);

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: '123456789@s.whatsapp.net',
          id: 'msg-1',
          fromMe: false,
        },
      ]);
    });

    it('normalizes participant JID when no @ suffix present', async () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await mgr.sendReadReceipt('group@g.us', ['msg-1'], '987654321');

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: 'group@g.us',
          id: 'msg-1',
          fromMe: false,
          participant: '987654321@s.whatsapp.net',
        },
      ]);
    });

    it('does not double-suffix participant JID when @ already present', async () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await mgr.sendReadReceipt('group@g.us', ['msg-1'], '987654321@s.whatsapp.net');

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: 'group@g.us',
          id: 'msg-1',
          fromMe: false,
          participant: '987654321@s.whatsapp.net',
        },
      ]);
    });

    it('throws when readMessages fails', async () => {
      const client = createMockClient();
      (client.readMessages as any).mockImplementation(async () => {
        throw new Error('Socket not initialized');
      });
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      await expect(mgr.sendReadReceipt('123', ['msg-1'])).rejects.toThrow('Socket not initialized');
    });
  });

  describe('start / stop (auto-read)', () => {
    it('subscribes to message events when autoRead is true', () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();

      const count = eventBus.listenerCount('message');
      expect(count).toBe(1);

      mgr.stop();
    });

    it('does NOT subscribe to message events when autoRead is false', () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      mgr.start();

      const count = eventBus.listenerCount('message');
      expect(count).toBe(0);
    });

    it('auto-read calls sendReadReceipt with correct JID and message ID', async () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();

      // Simulate a raw incoming message event (as emitted by client.ts)
      const rawMsg: any = {
        key: {
          remoteJid: '521234567890@s.whatsapp.net',
          fromMe: false,
          id: 'BAE5F6A1B2C3D4E5',
        },
        message: {
          conversation: 'Hola!',
        },
        messageTimestamp: 1715300000,
        pushName: 'Test User',
      };

      eventBus.emit('message', rawMsg as any);

      // Wait for fire-and-forget promise microtasks to flush
      await new Promise(r => setTimeout(r, 50));

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: '521234567890@s.whatsapp.net',
          id: 'BAE5F6A1B2C3D4E5',
          fromMe: false,
        },
      ]);

      mgr.stop();
    });

    it('auto-read includes participant for group messages', async () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();

      const rawMsg: any = {
        key: {
          remoteJid: '123456789@g.us',
          fromMe: false,
          id: 'GROUP-MSG-ID',
          participant: '987654321@s.whatsapp.net',
        },
        message: {
          conversation: 'Hello group!',
        },
        messageTimestamp: 1715300000,
        pushName: 'Group User',
      };

      eventBus.emit('message', rawMsg as any);

      // Wait for fire-and-forget promise microtasks to flush
      await new Promise(r => setTimeout(r, 50));

      expect(client.readMessages).toHaveBeenCalledWith([
        {
          remoteJid: '123456789@g.us',
          id: 'GROUP-MSG-ID',
          fromMe: false,
          participant: '987654321@s.whatsapp.net',
        },
      ]);

      mgr.stop();
    });

    it('auto-read skips messages without jid or id', async () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();

      // Message without jid
      eventBus.emit('message', { key: { id: 'msg-1' }, message: { conversation: 'hi' } } as any);
      // Message without id
      eventBus.emit('message', { key: { remoteJid: '123@s.whatsapp.net' }, message: { conversation: 'hi' } } as any);
      // Message with neither
      eventBus.emit('message', { key: {}, message: { conversation: 'hi' } } as any);
      // Message without key
      eventBus.emit('message', { message: { conversation: 'hi' } } as any);

      // Small delay to let fire-and-forget handlers run
      await new Promise(r => setTimeout(r, 100));

      expect(client.readMessages).not.toHaveBeenCalled();

      mgr.stop();
    });

    it('auto-read handles errors gracefully without crashing', async () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      (client.readMessages as any).mockImplementation(async () => {
        throw new Error('Socket not initialized');
      });
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();

      const rawMsg: any = {
        key: {
          remoteJid: '123@s.whatsapp.net',
          fromMe: false,
          id: 'MSG-1',
        },
        message: { conversation: 'test' },
      };

      // This should not throw — errors are caught in .catch()
      eventBus.emit('message', rawMsg as any);

      // Wait for fire-and-forget
      await new Promise(r => setTimeout(r, 100));

      // readMessages was called but threw — no crash
      expect(client.readMessages).toHaveBeenCalled();

      mgr.stop();
    });

    it('stop() unsubscribes from event bus', () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();
      expect(eventBus.listenerCount('message')).toBe(1);

      mgr.stop();
      expect(eventBus.listenerCount('message')).toBe(0);
    });

    it('stop() is safe to call when not started', () => {
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, mockConfig, logger);

      // stop() without start() should not throw
      expect(() => mgr.stop()).not.toThrow();
    });

    it('stop() is idempotent', () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();
      expect(eventBus.listenerCount('message')).toBe(1);

      mgr.stop();
      expect(eventBus.listenerCount('message')).toBe(0);

      // Second stop should not throw
      expect(() => mgr.stop()).not.toThrow();
      expect(eventBus.listenerCount('message')).toBe(0);
    });

    it('multiple start() calls subscribe only once (idempotent by unsubscribing first)', () => {
      const config: EnvConfig = { ...mockConfig, autoRead: true };
      const client = createMockClient();
      const eventBus = createEventBus();
      const mgr = createReadReceiptManager(client, eventBus, config, logger);

      mgr.start();
      mgr.start();
      mgr.start();

      // Each start() unsubscribes first before re-subscribing, so only 1 listener
      expect(eventBus.listenerCount('message')).toBe(1);

      mgr.stop();
      expect(eventBus.listenerCount('message')).toBe(0);
    });
  });
});
