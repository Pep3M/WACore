import { describe, expect, it, beforeAll, beforeEach, mock } from 'bun:test';
import { BufferJSON } from 'baileys/lib/Utils/generics.js';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'postgres' as const, sessionDir: '/tmp/sessions', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000,
  nodeEnv: 'test',
  databaseUrl: 'postgres://wacore:wacore@localhost:5432/wacore',
};
const logger = createLogger(mockConfig);

// ─── Mock state ────────────────────────────────────────────
const mockState: {
  rows: Array<Record<string, unknown>>;
  shouldFail: boolean;
  failCount: number;
  callCount: number;
  endCalled: boolean;
  endError: boolean;
  migrateCalled: boolean;
} = {
  rows: [],
  shouldFail: false,
  failCount: 0,
  callCount: 0,
  endCalled: false,
  endError: false,
  migrateCalled: false,
};

function createMockSql() {
  const sql = ((strings: TemplateStringsArray, ..._values: unknown[]) => {
    mockState.callCount++;
    if (mockState.shouldFail && mockState.callCount <= mockState.failCount) {
      return Promise.reject(new Error('connection refused'));
    }
    return Promise.resolve(mockState.rows);
  }) as unknown as {
    end: () => Promise<void>;
  } & ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>);

  (sql as any).end = () => {
    mockState.endCalled = true;
    if (mockState.endError) {
      return Promise.reject(new Error('end error'));
    }
    return Promise.resolve();
  };

  return sql;
}

// ─── Module mocks ──────────────────────────────────────────
mock.module('postgres', () => ({
  default: () => createMockSql(),
}));

mock.module('drizzle-orm/postgres-js', () => ({
  drizzle: () => ({}),
}));

mock.module('drizzle-orm/postgres-js/migrator', () => ({
  migrate: () => {
    mockState.migrateCalled = true;
    return Promise.resolve();
  },
}));

// ─── Dynamic imports ───────────────────────────────────────
let PostgresStoreClass: Awaited<ReturnType<typeof importAsync>>;
let PostgresDbModule: Awaited<ReturnType<typeof importDbAsync>>;

async function importAsync() {
  const mod = await import('../storage/postgres-store');
  return mod.PostgresStore;
}

async function importDbAsync() {
  return await import('../storage/postgres-db');
}

beforeAll(async () => {
  PostgresStoreClass = await importAsync();
  PostgresDbModule = await importDbAsync();
});

// ─── Reset state before each test ──────────────────────────
beforeEach(() => {
  mockState.rows = [];
  mockState.shouldFail = false;
  mockState.failCount = 0;
  mockState.callCount = 0;
  mockState.endCalled = false;
  mockState.endError = false;
  mockState.migrateCalled = false;
});

// ─── Tests ─────────────────────────────────────────────────
describe('PostgresStore', () => {
  it('checks existence when row exists', async () => {
    mockState.rows = [{ instance_name: 'test' }];
    const store = new PostgresStoreClass(mockConfig, logger);
    expect(await store.exists()).toBe(true);
  });

  it('checks existence when no row', async () => {
    mockState.rows = [];
    const store = new PostgresStoreClass(mockConfig, logger);
    expect(await store.exists()).toBe(false);
  });

  it('returns null when no session data exists', async () => {
    mockState.rows = [];
    const store = new PostgresStoreClass(mockConfig, logger);
    const result = await store.load();
    expect(result).toBeNull();
  });

  it('loads session data from PostgreSQL', async () => {
    const creds = { registrationId: 1, advSecretKey: 'abc' };
    const keys = { preKeys: [] };
    mockState.rows = [
      {
        creds: JSON.stringify(creds),
        keys: JSON.stringify(keys),
      },
    ];

    const store = new PostgresStoreClass(mockConfig, logger);
    const result = await store.load();
    expect(result).not.toBeNull();
    expect(result!.creds).toEqual(creds);
    expect(result!.keys).toEqual(keys);
  });

  it('saves session data to PostgreSQL', async () => {
    const creds = { registrationId: 2 };
    const keys = { preKeys: [1, 2, 3] };
    const store = new PostgresStoreClass(mockConfig, logger);
    await expect(store.save(creds, keys)).resolves.toBeUndefined();
  });

  it('deletes session data from PostgreSQL', async () => {
    const store = new PostgresStoreClass(mockConfig, logger);
    await expect(store.delete()).resolves.toBeUndefined();
  });

  it('backup is a no-op that logs debug', async () => {
    // Create a logger that tracks calls
    const debugLogger = createLogger({ ...mockConfig, logLevel: 'debug' });
    const store = new PostgresStoreClass(mockConfig, debugLogger);
    await expect(store.backup()).resolves.toBeUndefined();
  });

  it('calls end on disconnect', async () => {
    const store = new PostgresStoreClass(mockConfig, logger);
    await store.disconnect();
    expect(mockState.endCalled).toBe(true);
  });

  it('handles disconnect when end throws', async () => {
    mockState.endError = true;
    const store = new PostgresStoreClass(mockConfig, logger);
    await expect(store.disconnect()).resolves.toBeUndefined();
  });

  it('handles errors gracefully on exists', async () => {
    mockState.shouldFail = true;
    mockState.failCount = 1;
    const store = new PostgresStoreClass(mockConfig, logger);
    expect(await store.exists()).toBe(false);
  });

  it('handles errors gracefully on load', async () => {
    mockState.shouldFail = true;
    mockState.failCount = 1;
    const store = new PostgresStoreClass(mockConfig, logger);
    expect(await store.load()).toBeNull();
  });

  it('handles errors gracefully on save', async () => {
    mockState.shouldFail = true;
    mockState.failCount = 1;
    const store = new PostgresStoreClass(mockConfig, logger);
    await expect(store.save({}, {})).resolves.toBeUndefined();
  });

  it('handles errors gracefully on delete', async () => {
    mockState.shouldFail = true;
    mockState.failCount = 1;
    const store = new PostgresStoreClass(mockConfig, logger);
    await expect(store.delete()).resolves.toBeUndefined();
  });

  it('throws when no databaseUrl provided', () => {
    expect(() => {
      new PostgresStoreClass({ ...mockConfig, databaseUrl: undefined }, logger);
    }).toThrow('DATABASE_URL is required');
  });

  it('loads session with Buffer fields round-tripped', async () => {
    // Create credentials with actual Buffer instances (simulating real Baileys auth data)
    const creds = {
      noiseKey: {
        private: Buffer.from([1, 2, 3, 4]),
        public: Buffer.from([5, 6, 7, 8]),
      },
    };
    const keys = {
      preKeys: [{ key: Buffer.from([9, 10]) }],
    };

    // Simulate the full round-trip: BufferJSON.replacer → JSON string → JSONB (parsed JS object)
    const savedJson = JSON.stringify(creds, BufferJSON.replacer);
    const savedKeysJson = JSON.stringify(keys, BufferJSON.replacer);
    // JSONB returns a plain JS object (no reviver applied yet) — same as what postgres returns
    const postgresReturnedCreds = JSON.parse(savedJson);
    const postgresReturnedKeys = JSON.parse(savedKeysJson);

    mockState.rows = [
      {
        creds: postgresReturnedCreds,
        keys: postgresReturnedKeys,
      },
    ];

    const store = new PostgresStoreClass(mockConfig, logger);
    const result = await store.load();

    expect(result).not.toBeNull();

    // Verify that BufferJSON.reviver reconstructed Buffers correctly in load()
    const loadedCreds = result!.creds as Record<string, unknown>;
    const noiseKey = loadedCreds.noiseKey as Record<string, unknown>;

    expect(noiseKey.private).toBeInstanceOf(Buffer);
    expect(noiseKey.public).toBeInstanceOf(Buffer);
    expect(Array.from(noiseKey.private as Buffer)).toEqual([1, 2, 3, 4]);
    expect(Array.from(noiseKey.public as Buffer)).toEqual([5, 6, 7, 8]);
  });
});

// ─── waitForPostgres tests ──────────────────────────────────
describe('waitForPostgres', () => {
  it('succeeds when postgres is available', async () => {
    const { waitForPostgres } = PostgresDbModule;
    await expect(
      waitForPostgres('postgres://localhost:5432/db', logger, 5000),
    ).resolves.toBeUndefined();
  });

  it('throws timeout error when postgres is unavailable', async () => {
    const { waitForPostgres } = PostgresDbModule;
    mockState.shouldFail = true;
    mockState.failCount = Infinity;
    await expect(
      waitForPostgres('postgres://localhost:5432/db', logger, 100),
    ).rejects.toThrow('PostgreSQL not available');
  });
});

// ─── runMigrations tests ────────────────────────────────────
describe('runMigrations', () => {
  it('calls migrate and logs success', async () => {
    const { runMigrations } = PostgresDbModule;
    await expect(
      runMigrations('postgres://localhost:5432/db', logger),
    ).resolves.toBeUndefined();
    expect(mockState.migrateCalled).toBe(true);
    expect(mockState.endCalled).toBe(true);
  });
});

// ─── BufferJSON serialization ───────────────────────────────
describe('BufferJSON serialization', () => {
  it('round-trips Buffer through JSON', () => {
    const original = Buffer.from([104, 101, 108, 108, 111]);
    const serialized = JSON.stringify(original, BufferJSON.replacer);
    const parsed = JSON.parse(serialized, BufferJSON.reviver);
    expect(parsed).toBeInstanceOf(Buffer);
    expect(Buffer.from(parsed).toString()).toBe('hello');
  });

  it('round-trips complex objects with Buffers', () => {
    const obj = {
      name: 'test',
      data: Buffer.from([1, 2, 3]),
      nested: {
        key: Buffer.from([4, 5, 6]),
      },
    };
    const serialized = JSON.stringify(obj, BufferJSON.replacer);
    const parsed = JSON.parse(serialized, BufferJSON.reviver);
    expect(parsed.data).toBeInstanceOf(Buffer);
    expect(parsed.nested.key).toBeInstanceOf(Buffer);
    expect(Array.from(parsed.data)).toEqual([1, 2, 3]);
  });
});

// ─── createConnection ───────────────────────────────────────
describe('createConnection', () => {
  it('returns sql and db objects', () => {
    const { createConnection } = PostgresDbModule;
    const conn = createConnection('postgres://localhost:5432/db');
    expect(conn.sql).toBeDefined();
    expect(conn.db).toBeDefined();
    // Clean up
    conn.sql.end();
  });
});
