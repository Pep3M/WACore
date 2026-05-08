import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { FileStore } from '../storage/file-store';
import { createLogger } from '../utils/logger';

const testDir = '/tmp/wacore-test-filestore';
const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: testDir, webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test',
};
const logger = createLogger(mockConfig);

describe('FileStore', () => {
  beforeAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(`${testDir}/test`, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns false for non-existent session', async () => {
    const store = new FileStore({ ...mockConfig, instanceName: 'nonexistent' }, logger);
    expect(await store.exists()).toBe(false);
  });

  it('saves and loads session data', async () => {
    const store = new FileStore(mockConfig, logger);
    const creds = { registrationId: 1, advSecretKey: 'abc' };
    const keys = { preKeys: [] };

    await store.save(creds, keys);
    expect(await store.exists()).toBe(true);

    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.creds).toEqual(creds);
    expect(loaded!.keys).toEqual(keys);
  });

  it('deletes session data', async () => {
    const store = new FileStore(mockConfig, logger);
    await store.save({ reg: 1 }, {});
    expect(await store.exists()).toBe(true);
    await store.delete();
    expect(await store.exists()).toBe(false);
  });

  it('returns null when loading non-existent session', async () => {
    const store = new FileStore({ ...mockConfig, instanceName: 'ghost' }, logger);
    const loaded = await store.load();
    expect(loaded).toBeNull();
  });

  it('creates backup before saving', async () => {
    const store = new FileStore(mockConfig, logger);
    await store.save({ version: 1 }, {});

    const store2 = new FileStore(mockConfig, logger);
    await store2.save({ version: 2 }, {});

    const loaded = await store2.load();
    expect(loaded!.creds).toEqual({ version: 2 });
  });
});
