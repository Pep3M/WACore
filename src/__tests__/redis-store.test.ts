import { describe, expect, it, beforeAll, beforeEach, mock } from 'bun:test';
import type { RedisStore } from '../storage/redis-store';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'redis' as const, sessionDir: '/tmp/sessions', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', redisUrl: 'redis://localhost:6379',
};
const logger = createLogger(mockConfig);

const mockRedis = {
  exists: mock<(...args: string[]) => Promise<number>>(() => Promise.resolve(2)),
  get: mock<(...args: string[]) => Promise<string | null>>(() => Promise.resolve(null)),
  mset: mock<(...args: string[]) => Promise<'OK'>>(() => Promise.resolve('OK')),
  del: mock<(...args: string[]) => Promise<number>>(() => Promise.resolve(2)),
  bgsave: mock<(...args: string[]) => Promise<'OK'>>(() => Promise.resolve('OK')),
  quit: mock<(...args: string[]) => Promise<'OK'>>(() => Promise.resolve('OK')),
  disconnect: mock<() => void>(() => {}),
};

mock.module('ioredis', () => ({
  default: function RedisMock() {
    return mockRedis;
  },
}));

let RedisStoreClass: typeof RedisStore;

beforeAll(async () => {
  const mod = await import('../storage/redis-store');
  RedisStoreClass = mod.RedisStore;
});

describe('RedisStore', () => {
  beforeEach(() => {
    mockRedis.exists.mockClear();
    mockRedis.get.mockClear();
    mockRedis.mset.mockClear();
    mockRedis.del.mockClear();
    mockRedis.bgsave.mockClear();
    mockRedis.quit.mockClear();
  });

  it('checks existence of session keys', async () => {
    const store = new RedisStoreClass(mockConfig, logger);
    expect(await store.exists()).toBe(true);
    expect(mockRedis.exists).toHaveBeenCalledWith(
      'wacore:session:test:creds',
      'wacore:session:test:keys',
    );
  });

  it('returns false when keys are missing', async () => {
    mockRedis.exists.mockResolvedValueOnce(1);
    const store = new RedisStoreClass(mockConfig, logger);
    expect(await store.exists()).toBe(false);
  });

  it('returns null when no session data exists', async () => {
    const store = new RedisStoreClass(mockConfig, logger);
    const result = await store.load();
    expect(result).toBeNull();
  });

  it('loads session data from Redis', async () => {
    const creds = { registrationId: 1, advSecretKey: 'abc' };
    const keys = { preKeys: [] };
    mockRedis.get
      .mockResolvedValueOnce(JSON.stringify(creds))
      .mockResolvedValueOnce(JSON.stringify(keys));

    const store = new RedisStoreClass(mockConfig, logger);
    const result = await store.load();
    expect(result).not.toBeNull();
    expect(result!.creds).toEqual(creds);
    expect(result!.keys).toEqual(keys);
  });

  it('saves session data to Redis', async () => {
    const creds = { registrationId: 2 };
    const keys = { preKeys: [1, 2, 3] };
    const store = new RedisStoreClass(mockConfig, logger);
    await store.save(creds, keys);
    expect(mockRedis.mset).toHaveBeenCalledWith(
      'wacore:session:test:creds',
      JSON.stringify(creds),
      'wacore:session:test:keys',
      JSON.stringify(keys),
    );
  });

  it('deletes session data from Redis', async () => {
    const store = new RedisStoreClass(mockConfig, logger);
    await store.delete();
    expect(mockRedis.del).toHaveBeenCalledWith(
      'wacore:session:test:creds',
      'wacore:session:test:keys',
    );
  });

  it('triggers backup via BGSAVE', async () => {
    const store = new RedisStoreClass(mockConfig, logger);
    await store.backup();
    expect(mockRedis.bgsave).toHaveBeenCalled();
  });

  it('handles errors gracefully on exists', async () => {
    mockRedis.exists.mockRejectedValueOnce(new Error('connection refused'));
    const store = new RedisStoreClass(mockConfig, logger);
    expect(await store.exists()).toBe(false);
  });

  it('handles errors gracefully on load', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('timeout'));
    const store = new RedisStoreClass(mockConfig, logger);
    expect(await store.load()).toBeNull();
  });

  it('handles errors gracefully on save', async () => {
    mockRedis.mset.mockRejectedValueOnce(new Error('readonly'));
    const store = new RedisStoreClass(mockConfig, logger);
    await expect(store.save({}, {})).resolves.toBeUndefined();
  });

  it('handles errors gracefully on delete', async () => {
    mockRedis.del.mockRejectedValueOnce(new Error('readonly'));
    const store = new RedisStoreClass(mockConfig, logger);
    await expect(store.delete()).resolves.toBeUndefined();
  });

  it('handles errors gracefully on backup', async () => {
    mockRedis.bgsave.mockRejectedValueOnce(new Error('no save'));
    const store = new RedisStoreClass(mockConfig, logger);
    await expect(store.backup()).resolves.toBeUndefined();
  });

  it('handles partial session data (only creds exist)', async () => {
    mockRedis.get
      .mockResolvedValueOnce(JSON.stringify({ reg: 1 }))
      .mockResolvedValueOnce(null);
    const store = new RedisStoreClass(mockConfig, logger);
    expect(await store.load()).toBeNull();
  });
});
