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
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt++;
    const delay = attempt === 1
      ? 0
      : Math.min(Math.round(1000 * 1.5 ** (attempt - 2)), 5000);

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
      const elapsed = Date.now() - start;
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

export async function runMigrations(
  databaseUrl: string,
  logger: Logger,
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);
  try {
    await migrate(db, { migrationsFolder: './migrations' });
    logger.info('Database migrations applied successfully');
  } finally {
    await sql.end();
  }
}

export function createConnection(
  databaseUrl: string,
): { sql: postgres.Sql; db: DrizzleDB } {
  const sql = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  const db = drizzle(sql);
  return { sql, db };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
