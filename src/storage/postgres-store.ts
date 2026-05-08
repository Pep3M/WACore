import { BufferJSON } from 'baileys/lib/Utils/generics.js';
import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from './session-store';
import { createConnection } from './postgres-db';

export class PostgresStore implements SessionStore {
  private sql: ReturnType<typeof createConnection>['sql'];
  private instanceName: string;
  private logger: Logger;

  constructor(config: EnvConfig, logger: Logger) {
    const databaseUrl = config.databaseUrl;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for postgres session store');
    }
    const conn = createConnection(databaseUrl);
    this.sql = conn.sql;
    this.instanceName = config.instanceName;
    this.logger = logger;
  }

  async exists(): Promise<boolean> {
    try {
      const rows = await this.sql`
        SELECT 1 FROM wacore_sessions WHERE instance_name = ${this.instanceName} LIMIT 1
      `;
      return rows.length > 0;
    } catch (err) {
      this.logger.error('Failed to check session existence in PostgreSQL', {
        error: String(err),
      });
      return false;
    }
  }

  async load(): Promise<{ creds: unknown; keys: unknown } | null> {
    try {
      const rows = await this.sql<
        Array<{ creds: unknown; keys: unknown }>
      >`
        SELECT creds, keys FROM wacore_sessions WHERE instance_name = ${this.instanceName}
      `;
      if (rows.length === 0) {
        this.logger.debug('No session data found in PostgreSQL');
        return null;
      }
      const row = rows[0] as { creds: string; keys: string };
      const creds = JSON.parse(
        typeof row.creds === 'string' ? row.creds : JSON.stringify(row.creds),
        BufferJSON.reviver,
      );
      const keys = JSON.parse(
        typeof row.keys === 'string' ? row.keys : JSON.stringify(row.keys),
        BufferJSON.reviver,
      );
      this.logger.info('Session loaded from PostgreSQL');
      return { creds, keys };
    } catch (err) {
      this.logger.error('Failed to load session from PostgreSQL', {
        error: String(err),
      });
      return null;
    }
  }

  async save(creds: unknown, keys: unknown): Promise<void> {
    try {
      const credsJson = JSON.stringify(creds, BufferJSON.replacer);
      const keysJson = JSON.stringify(keys, BufferJSON.replacer);
      await this.sql`
        INSERT INTO wacore_sessions (instance_name, creds, keys, created_at, updated_at)
        VALUES (
          ${this.instanceName},
          ${credsJson}::jsonb,
          ${keysJson}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (instance_name)
        DO UPDATE SET
          creds = ${credsJson}::jsonb,
          keys = ${keysJson}::jsonb,
          updated_at = NOW()
      `;
      this.logger.debug('Session saved to PostgreSQL');
    } catch (err) {
      this.logger.error('Failed to save session to PostgreSQL', {
        error: String(err),
      });
    }
  }

  async delete(): Promise<void> {
    try {
      await this.sql`
        DELETE FROM wacore_sessions WHERE instance_name = ${this.instanceName}
      `;
      this.logger.warn('Session deleted from PostgreSQL');
    } catch (err) {
      this.logger.error('Failed to delete session from PostgreSQL', {
        error: String(err),
      });
    }
  }

  async backup(): Promise<void> {
    this.logger.debug('Backup delegated to PostgreSQL admin');
  }

  async disconnect(): Promise<void> {
    try {
      await this.sql.end();
    } catch {
      // Connection already closed
    }
  }
}
