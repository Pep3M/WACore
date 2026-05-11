import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DiskMediaStore } from '../storage/media-store';
import { createLogger } from '../utils/logger';

const testDir = '/tmp/wacore-test-mediastore';
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

describe('DiskMediaStore', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('creates directory on construction', () => {
    rmSync(testDir, { recursive: true, force: true });
    const store = new DiskMediaStore(testDir, logger);
    expect(existsSync(testDir)).toBe(true);
    store.remove('nonexistent');
  });

  it('saves and retrieves media', async () => {
    const store = new DiskMediaStore(testDir, logger);
    const buffer = Buffer.from('fake-image-data');
    const filePath = await store.save('media-001', buffer, 'jpg');
    expect(filePath).toBe(join(testDir, 'media-001.jpg'));
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath)).toEqual(buffer);
  });

  it('returns path for existing media', async () => {
    const store = new DiskMediaStore(testDir, logger);
    await store.save('media-002', Buffer.from('data'), 'png');
    const path = store.getPath('media-002');
    expect(path).toBe(join(testDir, 'media-002.png'));
    expect(store.exists('media-002')).toBe(true);
  });

  it('returns null for nonexistent media', () => {
    const store = new DiskMediaStore(testDir, logger);
    expect(store.getPath('nonexistent')).toBe(null);
    expect(store.exists('nonexistent')).toBe(false);
  });

  it('removes media', async () => {
    const store = new DiskMediaStore(testDir, logger);
    await store.save('media-003', Buffer.from('removable'), 'mp4');
    expect(store.exists('media-003')).toBe(true);
    await store.remove('media-003');
    expect(store.exists('media-003')).toBe(false);
  });

  it('provides info about stored media', async () => {
    const store = new DiskMediaStore(testDir, logger);
    await store.save('media-004', Buffer.from('info-data'), 'pdf');
    const info = store.getInfo('media-004');
    expect(info).not.toBeNull();
    expect(info!.mimetype).toBe('application/pdf');
    expect(info!.filename).toBe('media-004.pdf');
    expect(info!.size).toBe(9);
    expect(info!.downloadedAt).toBeGreaterThan(0);
  });

  it('lists all media IDs', async () => {
    const store = new DiskMediaStore(testDir, logger);
    await store.save('a', Buffer.from('1'), 'jpg');
    await store.save('b', Buffer.from('2'), 'png');
    const ids = store.getAllIds();
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('persists index across instances', async () => {
    const store1 = new DiskMediaStore(testDir, logger);
    await store1.save('persist-1', Buffer.from('test'), 'jpg');
    const store2 = new DiskMediaStore(testDir, logger);
    expect(store2.exists('persist-1')).toBe(true);
    expect(store2.getPath('persist-1')).toBe(join(testDir, 'persist-1.jpg'));
  });

  it('maps known extensions to correct MIME types', async () => {
    const store = new DiskMediaStore(testDir, logger);
    const checks: Array<[string, string, string]> = [
      ['img', 'jpg', 'image/jpeg'],
      ['doc', 'pdf', 'application/pdf'],
      ['vid', 'mp4', 'video/mp4'],
      ['aud', 'ogg', 'audio/ogg'],
      ['sticker', 'webp', 'image/webp'],
    ];
    for (const [id, ext, expectedMime] of checks) {
      await store.save(id, Buffer.from('x'), ext);
      const info = store.getInfo(id);
      expect(info!.mimetype).toBe(expectedMime);
    }
  });

  it('falls back to octet-stream for unknown extensions', async () => {
    const store = new DiskMediaStore(testDir, logger);
    await store.save('unknown', Buffer.from('x'), 'xyz');
    const info = store.getInfo('unknown');
    expect(info!.mimetype).toBe('application/octet-stream');
  });
});
