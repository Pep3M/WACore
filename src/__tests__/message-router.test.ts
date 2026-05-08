import { describe, expect, it, mock } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createMessageRouter } from '../core/message-router';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test',
};
const logger = createLogger(mockConfig);

function makeRawMessage(overrides: Record<string, any> = {}): any {
  return {
    key: { remoteJid: '123456@s.whatsapp.net', id: 'msg-001', fromMe: false },
    message: { conversation: 'Hello' },
    messageTimestamp: 1000000,
    pushName: 'TestUser',
    ...overrides,
  };
}

describe('MessageRouter', () => {
  it('normalizes text messages and emits typed event', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message.text', handler);
    router.start();

    const raw = makeRawMessage();
    bus.emit('message', raw);

    expect(handler).toHaveBeenCalledTimes(1);
    const normalized = handler.mock.calls[0]?.[0];
    expect(normalized.type).toBe('text');
    expect(normalized.body).toBe('Hello');
    expect(normalized.phone).toBe('123456');
    expect(normalized.from).toBe('123456@s.whatsapp.net');
    expect(normalized.isGroup).toBe(false);
    expect(normalized.pushName).toBe('TestUser');
  });

  it('emits type-specific events for each message type', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const textHandler = mock();
    const imageHandler = mock();

    bus.on('message.text', textHandler);
    bus.on('message.image', imageHandler);
    router.start();

    const raw = makeRawMessage({
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Photo' } },
    });
    bus.emit('message', raw);

    expect(textHandler).not.toHaveBeenCalled();
    expect(imageHandler).toHaveBeenCalledTimes(1);
    expect(imageHandler.mock.calls[0]?.[0].type).toBe('image');
  });

  it('handles group messages', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message.text', handler);
    router.start();

    const raw = makeRawMessage({
      key: { remoteJid: '123-456@g.us', id: 'msg-002', fromMe: false },
    });
    bus.emit('message', raw);

    const msg = handler.mock.calls[0]?.[0];
    expect(msg.isGroup).toBe(true);
    expect(msg.groupId).toBe('123-456@g.us');
  });

  it('handles reaction messages', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message.reaction', handler);
    router.start();

    const raw = makeRawMessage({
      message: { reactionMessage: { text: '👍', key: {} } },
    });
    bus.emit('message', raw);

    const msg = handler.mock.calls[0]?.[0];
    expect(msg.type).toBe('reaction');
    expect(msg.body).toBe('👍');
  });

  it('ignores unknown message types silently', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message', handler);
    router.start();

    const raw = makeRawMessage({
      message: { bogusMessage: {} },
    });
    bus.emit('message', raw);

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0]?.[0];
    expect(msg.message?.bogusMessage).toBeDefined();
  });
});
