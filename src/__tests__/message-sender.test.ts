import { describe, expect, it, mock } from 'bun:test';
import { createMessageSender } from '../services/message-sender';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test',
};
const logger = createLogger(mockConfig);

function createMockClient(): BaileysClient {
  return {
    socket: null,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    sendMessage: mock(async (jid: string, content: any) => ({
      key: { id: `msg-${jid}-${Date.now()}` },
    })),
    getConnectionStatus: mock(() => 'connected' as const),
    getQr: mock(() => null),
    logout: mock(async () => {}),
    connect: mock(async () => {}),
    getContacts: mock(() => []),
    uploadPreKeysToServerIfRequired: mock(async () => {}),
  };
}

describe('MessageSender', () => {
  it('sends text message and appends @s.whatsapp.net', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    const id = await sender.sendText('123456', 'Hello');

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { text: 'Hello' },
    );
    expect(id).toContain('msg-');
  });

  it('does not double-suffix jid when @ is present', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendText('123456@s.whatsapp.net', 'Hi');

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { text: 'Hi' },
    );
  });

  it('sends image media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'image',
      url: 'https://example.com/img.jpg',
      caption: 'Look!',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { image: { url: 'https://example.com/img.jpg' }, caption: 'Look!', mimetype: undefined },
    );
  });

  it('sends video media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'video',
      url: 'https://example.com/vid.mp4',
      caption: 'Video!',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { video: { url: 'https://example.com/vid.mp4' }, caption: 'Video!', mimetype: undefined },
    );
  });

  it('sends document media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'document',
      url: 'https://example.com/doc.pdf',
      filename: 'doc.pdf',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { document: { url: 'https://example.com/doc.pdf' }, fileName: 'doc.pdf', caption: undefined, mimetype: undefined },
    );
  });

  it('sends audio media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'audio',
      url: 'https://example.com/audio.ogg',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { audio: { url: 'https://example.com/audio.ogg' }, mimetype: undefined },
    );
  });

  it('throws for unsupported media type', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await expect(sender.sendMedia({
      to: '123456',
      type: 'unknown' as any,
      url: 'https://example.com/file',
    })).rejects.toThrow('Unsupported media type: unknown');
  });
});
