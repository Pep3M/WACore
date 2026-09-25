import { describe, expect, it, beforeAll, beforeEach, mock } from 'bun:test';
import { BufferJSON } from 'baileys/lib/Utils/generics.js';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'postgres' as const, sessionDir: '/tmp/sessions', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  databaseUrl: 'postgres://wacore:wacore@localhost:5432/wacore',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
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
  /** Todo lo interpolado en cada consulta, para poder afirmar qué recibe el driver. */
  valores: unknown[][];
  /** Con qué error falla, cuando `shouldFail`. Por defecto uno corriente de conexión. */
  error: unknown;
  /** Las opciones con las que se abrió el último pool. */
  opciones: Record<string, unknown> | undefined;
} = {
  rows: [],
  shouldFail: false,
  failCount: 0,
  callCount: 0,
  endCalled: false,
  endError: false,
  migrateCalled: false,
  valores: [],
  error: null,
  opciones: undefined,
};

function createMockSql() {
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    mockState.callCount++;
    mockState.valores.push(values);
    if (mockState.shouldFail && mockState.callCount <= mockState.failCount) {
      return Promise.reject(mockState.error ?? new Error('connection refused'));
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
  default: (_url: string, opciones?: Record<string, unknown>) => {
    mockState.opciones = opciones;
    return createMockSql();
  },
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
  mockState.valores = [];
  mockState.error = null;
  mockState.opciones = undefined;
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

  // El backoff arrancaba en 1 s fijo, así que un plazo de 100 ms tardaba 1 s en
  // rendirse: diez veces lo pedido.
  //
  // Se mide con `performance.now()`, no con `Date.now()`, por lo mismo que lo hace
  // la función: el reloj de pared puede saltar hacia atrás al resincronizar y este
  // test acabaría midiendo el salto en vez del backoff.
  it('se rinde dentro del plazo recibido, sin dormir de más', async () => {
    const { waitForPostgres } = PostgresDbModule;
    mockState.shouldFail = true;
    mockState.failCount = Infinity;

    const inicio = performance.now();
    await expect(
      waitForPostgres('postgres://localhost:5432/db', logger, 100),
    ).rejects.toThrow('PostgreSQL not available');
    const transcurrido = performance.now() - inicio;

    // Con el backoff sin acotar esto era >= 1000 ms.
    expect(transcurrido).toBeLessThan(700);
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

  /**
   * El pool nacía con `max: 3` y sin un solo plazo. Esa combinación es la que convertía una
   * consulta atascada en «ninguna línea de WhatsApp genera ya códigos QR»: tres tropiezos y no
   * quedaba conexión libre para nadie, y `sessionManager.create()` espera a la base **antes** de
   * arrancar Baileys.
   */
  it('abre el pool con plazos puestos en el servidor', () => {
    const { createConnection, configurarPoolPorDefecto } = PostgresDbModule;
    configurarPoolPorDefecto({});

    const conn = createConnection('postgres://localhost:5432/db');

    expect(mockState.opciones?.max).toBe(10);
    expect(mockState.opciones?.connection as Record<string, unknown>).toMatchObject({
      statement_timeout: 30_000,
      idle_in_transaction_session_timeout: 60_000,
    });
    conn.sql.end();
  });

  it('respeta el tamaño y los plazos configurados', () => {
    const { createConnection, configurarPoolPorDefecto, opcionesDePool } = PostgresDbModule;
    configurarPoolPorDefecto({ max: 25, statementTimeoutMs: 1_000, idleTxTimeoutMs: 2_000 });

    expect(opcionesDePool()).toEqual({ max: 25, statementTimeoutMs: 1_000, idleTxTimeoutMs: 2_000 });

    const conn = createConnection('postgres://localhost:5432/db');
    expect(mockState.opciones?.max).toBe(25);
    expect(mockState.opciones?.connection as Record<string, unknown>).toMatchObject({
      statement_timeout: 1_000,
      idle_in_transaction_session_timeout: 2_000,
    });

    conn.sql.end();
    configurarPoolPorDefecto({});
  });

  // `0` es la forma que tiene Postgres de decir «sin plazo», así que tiene que llegar tal cual:
  // es la única manera de desactivarlos desde la configuración sin tocar código.
  it('deja pasar el 0, que para Postgres significa sin plazo', () => {
    const { createConnection, configurarPoolPorDefecto } = PostgresDbModule;
    configurarPoolPorDefecto({ statementTimeoutMs: 0, idleTxTimeoutMs: 0 });

    const conn = createConnection('postgres://localhost:5432/db');
    expect(mockState.opciones?.connection as Record<string, unknown>).toMatchObject({
      statement_timeout: 0,
      idle_in_transaction_session_timeout: 0,
    });

    conn.sql.end();
    configurarPoolPorDefecto({});
  });
});

// ─── El Date que rompía la conexión ─────────────────────────
describe('PostgresSessionRegistry.updateStatus', () => {
  /**
   * El parámetro que reventaba. `postgres-js` serializa los valores mientras escribe el mensaje en
   * el socket; cuando ese paso falla, falla **a medias**, y la conexión queda inservible pero
   * vuelve al pool. Con un texto ISO no hay nada que el driver pueda romper: la conversión la hace
   * Postgres, que es quien sabe.
   */
  it('no le entrega nunca un Date al driver', async () => {
    const { PostgresSessionRegistry } = await import('../storage/postgres-store');
    const registry = new PostgresSessionRegistry(createMockSql() as never);

    await registry.updateStatus('1:42', {
      status: 'connected',
      phoneNumber: '+34612345678',
      lastSeenAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const valores = mockState.valores.at(-1)!;
    expect(valores.some(v => v instanceof Date)).toBe(false);
    expect(valores).toContain('2026-09-01T10:00:00.000Z');
  });

  it('tampoco cuando la fecha la pone él porque no se la dieron', async () => {
    const { PostgresSessionRegistry } = await import('../storage/postgres-store');
    const registry = new PostgresSessionRegistry(createMockSql() as never);

    await registry.updateStatus('1:42', { status: 'logged-out' });

    const valores = mockState.valores.at(-1)!;
    expect(valores.some(v => v instanceof Date)).toBe(false);
    expect(valores.some(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(v))).toBe(true);
  });
});

// ─── Un fallo de consulta no es una conexión rota ───────────
describe('conexiones corrompidas', () => {
  /** Un SQLSTATE es Postgres hablando: la consulta cayó, la conexión sigue sirviendo. */
  it('un error de Postgres no cuenta como conexión corrompida', async () => {
    const mod = await import('../storage/postgres-store');
    mod.reiniciarContadorConexionesCorrompidas();

    const err = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    mockState.shouldFail = true;
    mockState.failCount = 1;
    mockState.error = err;

    const store = new PostgresStoreClass(mockConfig, logger);
    await store.delete();

    expect(mod.esConexionCorrompida(err)).toBe(false);
    expect(mod.contadorConexionesCorrompidas()).toBe(0);
  });

  /**
   * El error real del incidente, literal. Antes se registraba como un aviso más entre muchos y la
   * conexión rota volvía al pool sin que nadie se enterara.
   */
  it('un TypeError del serializador sí cuenta', async () => {
    const mod = await import('../storage/postgres-store');
    mod.reiniciarContadorConexionesCorrompidas();

    const err = Object.assign(
      new TypeError('The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date'),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
    mockState.shouldFail = true;
    mockState.failCount = 1;
    mockState.error = err;

    const store = new PostgresStoreClass(mockConfig, logger);

    // Y sigue sin propagar: el único que llama aquí es `client.logout()`, y desde ahí un error
    // convertiría en un 500 la petición de desconectar una línea que sí se ha desconectado.
    await store.delete();

    expect(mod.esConexionCorrompida(err)).toBe(true);
    expect(mod.contadorConexionesCorrompidas()).toBe(1);
  });

  it('lo cuenta venga de donde venga, no solo de delete()', async () => {
    const mod = await import('../storage/postgres-store');
    mod.reiniciarContadorConexionesCorrompidas();

    mockState.shouldFail = true;
    mockState.failCount = 3;
    mockState.error = new TypeError('Received an instance of Date');

    const store = new PostgresStoreClass(mockConfig, logger);
    await store.exists();
    await store.load();
    await store.save({}, {});

    expect(mod.contadorConexionesCorrompidas()).toBe(3);
  });

  it('un fallo de conexión corriente sigue tratándose como antes', async () => {
    const mod = await import('../storage/postgres-store');
    mod.reiniciarContadorConexionesCorrompidas();

    mockState.shouldFail = true;
    mockState.failCount = 1;
    mockState.error = new Error('connection refused');

    const store = new PostgresStoreClass(mockConfig, logger);
    expect(await store.exists()).toBe(false);
    expect(mod.contadorConexionesCorrompidas()).toBe(0);
  });
});
