import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createIncomingMessageHub } from '../core/incoming-message-hub';
import { createLogger } from '../utils/logger';
import type { NormalizedMessage } from '../types';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, pollingEnabled: false, sseEnabled: false,
  messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};

const logger = createLogger(mockConfig);

let msgCounter = 0;

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  msgCounter++;
  return {
    id: `msg-${String(msgCounter).padStart(3, '0')}`,
    from: '123456@s.whatsapp.net',
    phone: '123456',
    pushName: 'TestUser',
    isGroup: false,
    groupId: null,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'text',
    body: 'Hello',
    quotedMessage: null,
    media: null,
    ...overrides,
  };
}

function makeMessageWithTimestamp(ts: number, overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  msgCounter++;
  return {
    id: `msg-${String(msgCounter).padStart(3, '0')}`,
    from: '123456@s.whatsapp.net',
    phone: '123456',
    pushName: 'TestUser',
    isGroup: false,
    groupId: null,
    timestamp: ts,
    type: 'text',
    body: 'Hello',
    quotedMessage: null,
    media: null,
    ...overrides,
  };
}

describe('IncomingMessageHub', () => {
  describe('buffer operations', () => {
    it('inserts and retrieves messages', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      hub.start();

      bus.emit('message.text', makeMessage({ id: 'msg-a', body: 'Hello' }));
      bus.emit('message.text', makeMessage({ id: 'msg-b', body: 'World' }));

      const result = hub.getRecentMessages();
      expect(result.messages).toHaveLength(2);

      const bodies = result.messages.map(m => m.body).sort();
      expect(bodies).toEqual(['Hello', 'World']);

      hub.stop();
    });

    it('respects maxSize with FIFO eviction', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 3, ttlMs: 60000 });
      hub.start();

      const now = Math.floor(Date.now() / 1000);
      bus.emit('message.text', makeMessageWithTimestamp(now - 10, { id: 'msg-1' }));
      bus.emit('message.text', makeMessageWithTimestamp(now - 8, { id: 'msg-2' }));
      bus.emit('message.text', makeMessageWithTimestamp(now - 6, { id: 'msg-3' }));
      bus.emit('message.text', makeMessageWithTimestamp(now - 4, { id: 'msg-4' }));

      const result = hub.getRecentMessages();
      expect(result.messages).toHaveLength(3);
      expect(result.messages.some(m => m.id === 'msg-1')).toBe(false);
      expect(result.messages.some(m => m.id === 'msg-2')).toBe(true);

      hub.stop();
    });

    it('respects TTL and does not return expired messages', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 5000 });
      hub.start();

      const oldTimestamp = Math.floor((Date.now() - 10000) / 1000);
      bus.emit('message.text', makeMessageWithTimestamp(oldTimestamp, { id: 'msg-old' }));
      bus.emit('message.text', makeMessage({ id: 'msg-fresh' }));

      // Sleep briefly so the fresh message timestamp is properly set
      const result = hub.getRecentMessages();
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.id).toBe('msg-fresh');

      hub.stop();
    });
  });

  describe('handlers', () => {
    it('registerHandler receives messages', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      const handler = mock();

      hub.registerHandler(handler);
      hub.start();

      bus.emit('message.text', makeMessage({ id: 'msg-handler-1' }));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0].id).toBe('msg-handler-1');

      hub.stop();
    });

    it('registerHandler returns unsubscribe function', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      const handler = mock();

      const unsub = hub.registerHandler(handler);
      hub.start();

      bus.emit('message.text', makeMessage({ id: 'msg-unsub-1' }));
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      bus.emit('message.text', makeMessage({ id: 'msg-unsub-2' }));
      expect(handler).toHaveBeenCalledTimes(1);

      hub.stop();
    });

    it('handler error does not affect other handlers', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      const failingHandler = mock(() => { throw new Error('handler error'); });
      const goodHandler = mock();

      hub.registerHandler(failingHandler);
      hub.registerHandler(goodHandler);
      hub.start();

      expect(() => {
        bus.emit('message.text', makeMessage({ id: 'msg-error-test' }));
      }).not.toThrow();

      expect(goodHandler).toHaveBeenCalledTimes(1);
      expect(failingHandler).toHaveBeenCalledTimes(1);

      hub.stop();
    });

    it('unregisterHandler removes handler', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      const handler = mock();

      hub.registerHandler(handler);
      hub.start();

      bus.emit('message.text', makeMessage({ id: 'msg-unreg-1' }));
      expect(handler).toHaveBeenCalledTimes(1);

      hub.unregisterHandler(handler);
      bus.emit('message.text', makeMessage({ id: 'msg-unreg-2' }));
      expect(handler).toHaveBeenCalledTimes(1);

      hub.stop();
    });
  });

  describe('getRecentMessages', () => {
    it('filters by since parameter', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      hub.start();

      const early = Math.floor((Date.now() - 10000) / 1000);
      bus.emit('message.text', makeMessageWithTimestamp(early, { id: 'msg-early', body: 'early' }));
      bus.emit('message.text', makeMessage({ id: 'msg-recent', body: 'recent' }));

      const since = new Date((early + 1) * 1000).toISOString();
      const result = hub.getRecentMessages(since);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]?.id).toBe('msg-recent');

      hub.stop();
    });

    it('respects limit parameter', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      hub.start();

      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 10; i++) {
        bus.emit('message.text', makeMessageWithTimestamp(now - (10 - i), { id: `msg-limit-${i}` }));
      }

      const result = hub.getRecentMessages(undefined, 3);
      expect(result.messages).toHaveLength(3);
      expect(result.hasMore).toBe(true);
      expect(result.cursor).not.toBeNull();

      hub.stop();
    });

    it('returns empty messages when no messages match', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      hub.start();

      const result = hub.getRecentMessages();
      expect(result.messages).toHaveLength(0);
      expect(result.cursor).toBeNull();
      expect(result.hasMore).toBe(false);

      hub.stop();
    });

    it('returns hasMore correctly at boundary', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      hub.start();

      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 5; i++) {
        bus.emit('message.text', makeMessageWithTimestamp(now - (5 - i), { id: `msg-boundary-${i}` }));
      }

      const result = hub.getRecentMessages(undefined, 5);
      expect(result.messages).toHaveLength(5);
      expect(result.hasMore).toBe(false);

      hub.stop();
    });
  });

  describe('lifecycle', () => {
    it('start/stop lifecycle works correctly', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
      const handler = mock();

      hub.registerHandler(handler);

      bus.emit('message.text', makeMessage({ id: 'msg-life-before' }));
      expect(handler).not.toHaveBeenCalled();
      expect(hub.getRecentMessages().messages).toHaveLength(0);

      hub.start();

      bus.emit('message.text', makeMessage({ id: 'msg-life-after' }));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(hub.getRecentMessages().messages).toHaveLength(1);

      hub.stop();

      const afterStopCount = handler.mock.calls.length;
      bus.emit('message.text', makeMessage({ id: 'msg-life-after-stop' }));
      expect(handler.mock.calls.length).toBe(afterStopCount);
    });

    it('can be started and stopped multiple times', () => {
      const bus = createEventBus();
      const hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });

      hub.start();
      hub.stop();
      hub.start();
      hub.stop();

      expect(true).toBe(true);
    });
  });
});
