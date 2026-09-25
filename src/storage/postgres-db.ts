import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { Logger } from '../utils/logger';

export const sessions = pgTable('wacore_sessions', {
  instanceName: text('instance_name').primaryKey(),
  creds:        jsonb('creds').notNull(),
  keys:         jsonb('keys').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type DrizzleDB = PostgresJsDatabase;

export async function waitForPostgres(
  databaseUrl: string,
  logger: Logger,
  timeoutMs: number,
): Promise<void> {
  // Reloj monotónico a propósito. `Date.now()` puede saltar hacia atrás cuando la
  // máquina resincroniza la hora, y una VM lo hace justo al arrancar — que es
  // exactamente cuando corre esta espera. Con el reloj de pared, un salto atrás
  // dejaba el bucle dando vueltas mucho más allá del plazo en vez de rendirse:
  // medido en una WSL2 cuyo reloj oscilaba ±29 s, la espera se comía esos 29 s.
  const start = performance.now();
  const transcurrido = (): number => performance.now() - start;
  let attempt = 0;

  while (transcurrido() < timeoutMs) {
    attempt++;
    // El backoff tampoco puede dormir más allá del plazo recibido: con un
    // `timeoutMs` corto, un `sleep` de 1 s tardaba diez veces el presupuesto.
    const restante = timeoutMs - transcurrido();
    const delay = attempt === 1
      ? 0
      : Math.min(Math.round(1000 * 1.5 ** (attempt - 2)), 5000, Math.max(restante, 0));

    if (delay > 0) {
      await sleep(delay);
    }

    try {
      const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
      await sql`SELECT 1`;
      await sql.end();
      logger.info('PostgreSQL connection established', { attempts: attempt });
      return;
    } catch {
      const elapsed = transcurrido();
      if (elapsed >= timeoutMs) {
        throw new Error(
          `PostgreSQL not available after ${timeoutMs}ms (${attempt} attempts)`,
        );
      }
      logger.debug('Waiting for PostgreSQL', { attempt, delay, elapsed });
    }
  }

  throw new Error(`PostgreSQL not available after ${timeoutMs}ms`);
}

interface JournalEntry { idx: number; when: number; tag: string }

export async function runMigrations(
  databaseUrl: string,
  logger: Logger,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    // Diagnóstico previo: Drizzle sólo aplica migraciones con `when` > max(created_at) en
    // `drizzle.__drizzle_migrations`. Si el journal tiene timestamps no monótonos crecientes
    // (típicamente 0000 con fecha real posterior a los siguientes), las migraciones nuevas
    // se silencian sin error. Comparamos aquí para avisar al operador antes de que el
    // "applied successfully" mienta.
    const journalPath = new URL('../../migrations/meta/_journal.json', import.meta.url);
    let journal: { entries?: JournalEntry[] } = {};
    try {
      const raw = await import('node:fs/promises').then(m => m.readFile(journalPath, 'utf8'));
      journal = JSON.parse(raw);
    } catch {
      logger.warn('Could not read migrations/meta/_journal.json for pre-flight check');
    }
    const entries = journal.entries ?? [];

    let lastAppliedMs: number | null = null;
    try {
      const rows = await sql<{ created_at: string }[]>`
        SELECT created_at FROM drizzle.__drizzle_migrations
        ORDER BY created_at DESC LIMIT 1
      `;
      if (rows[0]) lastAppliedMs = Number(rows[0].created_at);
    } catch {
      // Tabla no existe todavía — primer arranque. Todas se aplicarán.
    }

    const pending = entries.filter(e => lastAppliedMs === null || e.when > lastAppliedMs);

    // Detecta timestamps no monótonos crecientes (bug real que ya nos golpeó dos veces:
    // 0000 con `when` en 2026 hacía que 0004/0005 con `when` en 2025 nunca se aplicaran).
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!;
      const cur = entries[i]!;
      if (cur.when <= prev.when) {
        logger.error(
          'Migration journal has non-monotonic timestamps — new migrations may be silently skipped',
          { previous: `${prev.tag} @ ${prev.when}`, current: `${cur.tag} @ ${cur.when}` },
        );
      }
    }

    logger.info('Migration pre-flight', {
      journalEntries: entries.length,
      lastAppliedMs,
      pending: pending.map(e => e.tag),
    });

    await migrate(db, { migrationsFolder: './migrations' });

    // Post-flight: recomputa qué debería haberse aplicado y compara con la DB.
    if (pending.length > 0) {
      const rows = await sql<{ created_at: string }[]>`
        SELECT created_at FROM drizzle.__drizzle_migrations
        ORDER BY created_at DESC LIMIT 1
      `;
      const newMax = rows[0] ? Number(rows[0].created_at) : null;
      const stillPending = pending.filter(e => newMax === null || e.when > newMax);
      if (stillPending.length > 0) {
        logger.error(
          'Drizzle reported success but some migrations were NOT applied — likely a non-monotonic `when` in _journal.json',
          { stillPending: stillPending.map(e => e.tag), lastAppliedMs: newMax },
        );
      } else {
        logger.info('Migrations applied', { applied: pending.map(e => e.tag) });
      }
    } else {
      logger.info('Migrations up to date (nothing to apply)');
    }
  } finally {
    await sql.end();
  }
}

export interface OpcionesPool {
  /** Conexiones simultáneas. */
  max: number;
  /** Milisegundos tras los que Postgres aborta una consulta. `0` lo desactiva. */
  statementTimeoutMs: number;
  /** Milisegundos tras los que Postgres cierra una transacción abierta y ociosa. `0` lo desactiva. */
  idleTxTimeoutMs: number;
}

/**
 * Los plazos con los que nace **cualquier** pool que no diga otra cosa.
 *
 * Son deliberadamente los mismos números que los valores por omisión de `loadConfig()`: quien no
 * llame a {@link configurarPoolPorDefecto} —los tests, sobre todo— sigue teniendo un pool seguro.
 */
const POR_OMISION: OpcionesPool = {
  max: 10,
  statementTimeoutMs: 30_000,
  idleTxTimeoutMs: 60_000,
};

let opcionesActuales: OpcionesPool = { ...POR_OMISION };

/**
 * Fija los plazos de **todos** los pools que se abran después.
 *
 * Se llama una sola vez, al arrancar, con la configuración ya leída. La alternativa era pasar las
 * opciones por parámetro hasta los diez sitios que abren un pool —cuatro de ellos a través de
 * fábricas que hoy solo reciben la URL—, y entonces la mitad se habría quedado sin plazos por
 * descuido. Aquí no hay forma de olvidarse de ninguno.
 */
export function configurarPoolPorDefecto(opciones: Partial<OpcionesPool>): void {
  opcionesActuales = {
    max: opciones.max && opciones.max > 0 ? opciones.max : POR_OMISION.max,
    statementTimeoutMs: opciones.statementTimeoutMs ?? POR_OMISION.statementTimeoutMs,
    idleTxTimeoutMs: opciones.idleTxTimeoutMs ?? POR_OMISION.idleTxTimeoutMs,
  };
}

/** Lo que se está usando ahora mismo. Existe para poder afirmarlo en un test. */
export function opcionesDePool(): OpcionesPool {
  return { ...opcionesActuales };
}

/**
 * Abre un pool de Postgres.
 *
 * **Los dos plazos no son adorno.** Sin ellos, una consulta atascada lo está para siempre y se
 * lleva su conexión del pool con ella; con `max: 3` —lo que había— tres tropiezos dejaban a WACore
 * sin base de datos, y como `sessionManager.create()` espera a la base **antes** de arrancar
 * Baileys, el síntoma que se veía era que ninguna línea generaba ya códigos QR.
 *
 * Cubren dos averías distintas y ninguna de las dos cubre a la otra: `statement_timeout` corta una
 * consulta que está esperando (un bloqueo de fila, una base lenta) e `idle_in_transaction_session_timeout`
 * cierra una transacción que alguien dejó abierta.
 *
 * **Y aun así no lo cubren todo:** un cliente que deja la conversación a medias deja al servidor en
 * `wait_event = ClientRead` con el enunciado ya terminado, y ahí no salta ninguno de los dos. Para
 * eso está el vigilante de `postgres-watchdog.ts`, y el plazo de cliente del gestor de sesiones.
 *
 * `max_lifetime` recicla conexiones sanas cada media hora: una conexión eterna acumula estado de
 * servidor —planes preparados, temporales— que nadie vuelve a mirar.
 */
export function createConnection(
  databaseUrl: string,
  opciones: Partial<OpcionesPool> = {},
): { sql: postgres.Sql; db: DrizzleDB } {
  const { max, statementTimeoutMs, idleTxTimeoutMs } = { ...opcionesActuales, ...limpiar(opciones) };

  const sql = postgres(databaseUrl, {
    max,
    idle_timeout: 30,
    connect_timeout: 10,
    max_lifetime: 30 * 60,
    // Postgres los entiende en milisegundos. `0` es su forma de decir «sin plazo», así que se puede
    // desactivar cualquiera de los dos sin tocar código.
    connection: {
      statement_timeout: Math.max(0, statementTimeoutMs),
      idle_in_transaction_session_timeout: Math.max(0, idleTxTimeoutMs),
    },
  });
  const db = drizzle(sql);
  return { sql, db };
}

/** Quita las claves sin valor para que no pisen los valores por defecto con `undefined`. */
function limpiar(opciones: Partial<OpcionesPool>): Partial<OpcionesPool> {
  const salida: Partial<OpcionesPool> = {};
  if (typeof opciones.max === 'number' && opciones.max > 0) salida.max = opciones.max;
  if (typeof opciones.statementTimeoutMs === 'number') salida.statementTimeoutMs = opciones.statementTimeoutMs;
  if (typeof opciones.idleTxTimeoutMs === 'number') salida.idleTxTimeoutMs = opciones.idleTxTimeoutMs;
  return salida;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
