import { describe, expect, it, mock, spyOn, afterEach } from 'bun:test';
import { createPresenceManager } from '../services/presence-manager';
import { createLogger } from '../utils/logger';
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
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};
const logger = createLogger(mockConfig);

const noop = async () => {};

function createMockClient(): BaileysClient {
  return {
    socket: null,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    sendMessage: mock(async () => ({ key: { id: 'msg-1' } })),
    sendPresenceUpdate: mock(async (jid: string, _type: PresenceType) => {}),
    getConnectionStatus: mock(() => 'connected' as const),
    getQr: mock(() => null),
    logout: mock(async () => {}),
    connect: mock(async () => {}),
    getContacts: mock(() => []),
    uploadPreKeysToServerIfRequired: mock(async () => {}),
  };
}

describe('PresenceManager', () => {
  afterEach(() => {
    mock.restore();
  });

  describe('setPresence', () => {
    it('sends presence update with normalized jid', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      await pm.setPresence('123456', 'composing');

      expect(client.sendPresenceUpdate).toHaveBeenCalledWith(
        '123456@s.whatsapp.net',
        'composing',
      );
    });

    it('does not double-suffix jid when @ is present', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      await pm.setPresence('123456@s.whatsapp.net', 'recording');

      expect(client.sendPresenceUpdate).toHaveBeenCalledWith(
        '123456@s.whatsapp.net',
        'recording',
      );
    });

    it('sends all presence types', async () => {
      const types: PresenceType[] = ['composing', 'recording', 'paused', 'available', 'unavailable'];
      for (const type of types) {
        const client = createMockClient();
        const pm = createPresenceManager(client, mockConfig, logger);
        await pm.setPresence('123', type);
        expect(client.sendPresenceUpdate).toHaveBeenCalledWith('123@s.whatsapp.net', type);
      }
    });

    it('stops active typing timer when setting presence', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);
      pm.startTyping('123456');

      await pm.setPresence('123456', 'recording');

      expect(client.sendPresenceUpdate).toHaveBeenLastCalledWith(
        '123456@s.whatsapp.net', 'recording',
      );
      // startTyping sent composing (1), so 3 calls: composing + paused(reset) + recording
      const calls = (client.sendPresenceUpdate as any).mock.calls;
      expect(calls.length).toBe(3);
      expect(calls[0]).toEqual(['123456@s.whatsapp.net', 'composing']);
      expect(calls[1]).toEqual(['123456@s.whatsapp.net', 'paused']);
      expect(calls[2]).toEqual(['123456@s.whatsapp.net', 'recording']);
    });

    it('does not send paused on first setPresence chatstate call', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      await pm.setPresence('123456', 'recording');

      expect(client.sendPresenceUpdate).toHaveBeenCalledTimes(1);
      expect(client.sendPresenceUpdate).toHaveBeenCalledWith(
        '123456@s.whatsapp.net', 'recording',
      );
    });

    it('sends paused before switching composing to recording', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      await pm.setPresence('123456', 'composing');
      await pm.setPresence('123456', 'recording');

      const calls = (client.sendPresenceUpdate as any).mock.calls;
      expect(calls[0]).toEqual(['123456@s.whatsapp.net', 'composing']);
      expect(calls[1]).toEqual(['123456@s.whatsapp.net', 'paused']);
      expect(calls[2]).toEqual(['123456@s.whatsapp.net', 'recording']);
    });

    it('sends paused only once when switching composing to paused', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      await pm.setPresence('123456', 'composing');
      await pm.setPresence('123456', 'paused');

      const calls = (client.sendPresenceUpdate as any).mock.calls;
      expect(calls.length).toBe(2);
      expect(calls[0]).toEqual(['123456@s.whatsapp.net', 'composing']);
      expect(calls[1]).toEqual(['123456@s.whatsapp.net', 'paused']);
    });

    it('available after composing does not send paused (different channel)', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      await pm.setPresence('123456', 'composing');
      await pm.setPresence('123456', 'available');

      const calls = (client.sendPresenceUpdate as any).mock.calls;
      expect(calls.length).toBe(2);
      expect(calls[0]).toEqual(['123456@s.whatsapp.net', 'composing']);
      expect(calls[1]).toEqual(['123456@s.whatsapp.net', 'available']);
    });
  });

  describe('startTyping / stopTyping', () => {
    it('startTyping sends composing immediately', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      pm.startTyping('123456');

      expect(client.sendPresenceUpdate).toHaveBeenCalledWith(
        '123456@s.whatsapp.net',
        'composing',
      );
    });

    it('startTyping is idempotent', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      pm.startTyping('123456');
      pm.startTyping('123456');

      expect(client.sendPresenceUpdate).toHaveBeenCalledTimes(1);
    });

    it('startTyping sets an interval to refresh composing', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      const spy = spyOn(globalThis, 'setInterval');
      pm.startTyping('123456');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), 3000);
      spy.mockRestore();
    });

    it('stopTyping sends paused and clears interval', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      const clearSpy = spyOn(globalThis, 'clearInterval');
      pm.startTyping('123456');
      pm.stopTyping('123456');

      expect(client.sendPresenceUpdate).toHaveBeenLastCalledWith(
        '123456@s.whatsapp.net',
        'paused',
      );
      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it('stopTyping without start does not throw', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      expect(() => pm.stopTyping('123456')).not.toThrow();
    });

    it('startTyping supports multiple distinct jids', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      pm.startTyping('111');
      pm.startTyping('222');

      expect(client.sendPresenceUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendWithTyping', () => {
    it('sends composing, executes fn, sends paused when autoTyping=true', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);
      let executed = false;

      await pm.sendWithTyping('123456', async () => {
        executed = true;
      });

      expect(executed).toBe(true);
      expect(client.sendPresenceUpdate).toHaveBeenNthCalledWith(
        1, '123456@s.whatsapp.net', 'composing',
      );
      expect(client.sendPresenceUpdate).toHaveBeenLastCalledWith(
        '123456@s.whatsapp.net', 'paused',
      );
    });

    it('returns the value from sendFn', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      const result = await pm.sendWithTyping('456', async () => 'hello');

      expect(result).toBe('hello');
    });

    it('sends paused even when sendFn throws', async () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      await expect(pm.sendWithTyping('123', async () => {
        throw new Error('boom');
      })).rejects.toThrow('boom');

      expect(client.sendPresenceUpdate).toHaveBeenLastCalledWith(
        '123@s.whatsapp.net', 'paused',
      );
    });

    it('only executes fn when autoTyping=false', async () => {
      const client = createMockClient();
      const configNoAuto = { ...mockConfig, autoTyping: false };
      const pm = createPresenceManager(client, configNoAuto as EnvConfig, logger);
      let executed = false;

      await pm.sendWithTyping('123', async () => {
        executed = true;
      });

      expect(executed).toBe(true);
      expect(client.sendPresenceUpdate).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('clears all typing timers', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);
      const clearSpy = spyOn(globalThis, 'clearInterval');

      pm.startTyping('111');
      pm.startTyping('222');
      pm.stop();

      expect(clearSpy).toHaveBeenCalledTimes(2);
      clearSpy.mockRestore();
    });

    it('clears timers then prevents new typing updates', () => {
      const client = createMockClient();
      const pm = createPresenceManager(client, mockConfig, logger);

      pm.startTyping('111');
      pm.stop();
      pm.startTyping('111'); // should not send again since stop cleared map

      expect(client.sendPresenceUpdate).toHaveBeenCalledTimes(2); // composing + start from stop
    });
  });
});
