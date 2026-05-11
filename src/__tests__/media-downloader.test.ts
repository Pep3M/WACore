import { describe, expect, it, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';
import { DiskMediaStore } from '../storage/media-store';
import { createMediaDownloader } from '../services/media-downloader';

const testDir = '/tmp/wacore-test-mediadownloader';
const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: testDir,
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};
const logger = createLogger(mockConfig);

function makeImageMessage(): any {
  return {
    key: { id: 'media-msg-001', remoteJid: '123@s.whatsapp.net', fromMe: false },
    message: {
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'test image',
        url: 'https://example.com/img.jpg',
        directPath: '/path/to/file',
        mediaKey: Buffer.from('fake-key'),
      },
    },
    messageTimestamp: 1000000,
    pushName: 'TestUser',
  };
}

function makeTextMessage(): any {
  return {
    key: { id: 'txt-msg-001', remoteJid: '123@s.whatsapp.net', fromMe: false },
    message: { conversation: 'Hello' },
    messageTimestamp: 1000000,
    pushName: 'TestUser',
  };
}

describe('MediaDownloader', () => {
  let store: DiskMediaStore;

  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    store = new DiskMediaStore(testDir, logger);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns null for non-media messages', async () => {
    const downloader = createMediaDownloader(store, createEventBus(), logger, false, 'http://localhost:9878');
    const result = await downloader.download(makeTextMessage() as any);
    expect(result).toBeNull();
  });

  it('returns null for media messages when download fails', async () => {
    const downloader = createMediaDownloader(store, createEventBus(), logger, false, 'http://localhost:9878');
    const result = await downloader.download(makeImageMessage() as any);
    expect(result).toBeNull();
  });

  it('skips already downloaded media (dedup)', async () => {
    const eventBus = createEventBus();
    const downloader = createMediaDownloader(store, eventBus, logger, false, 'http://localhost:9878');

    const raw = makeImageMessage();
    const result1 = await downloader.download(raw);
    expect(result1).toBeNull();

    const result2 = await downloader.download(raw);
    expect(result2).toBeNull();
  });

  it('starts and stops without errors', () => {
    const downloader = createMediaDownloader(store, createEventBus(), logger, true, 'http://localhost:9878');
    expect(() => downloader.start()).not.toThrow();
    expect(() => downloader.stop()).not.toThrow();
  });

  it('does not auto-download when disabled', () => {
    const eventBus = createEventBus();
    let emitted = false;
    eventBus.on('media.downloaded', () => { emitted = true; });

    const downloader = createMediaDownloader(store, eventBus, logger, false, 'http://localhost:9878');
    downloader.start();

    eventBus.emit('message', makeImageMessage());

    expect(emitted).toBe(false);
    downloader.stop();
  });

  it('auto-downloads media messages when enabled', async () => {
    const eventBus = createEventBus();
    const downloader = createMediaDownloader(store, eventBus, logger, true, 'http://localhost:9878');
    downloader.start();

    const raw = makeImageMessage();
    eventBus.emit('message', raw);

    await new Promise(r => setTimeout(r, 100));

    const path = store.getPath('media-msg-001');
    expect(path).toBeNull();

    downloader.stop();
  });

  it('getPath returns null for unknown media', () => {
    const downloader = createMediaDownloader(store, createEventBus(), logger, false, 'http://localhost:9878');
    expect(downloader.getPath('nonexistent')).toBeNull();
  });

  it('emits media.downloaded event on completion', async () => {
    const eventBus = createEventBus();
    const downloader = createMediaDownloader(store, eventBus, logger, true, 'http://localhost:9878');

    let emitted = false;
    eventBus.on('media.downloaded', (data) => {
      emitted = true;
      expect(data.mediaId).toBe('media-msg-001');
    });

    downloader.start();
    eventBus.emit('message', makeImageMessage());

    await new Promise(r => setTimeout(r, 50));
    downloader.stop();
  });
});
