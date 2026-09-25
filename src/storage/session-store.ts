import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type postgres from 'postgres';

export interface SessionStore {
  save(creds: unknown, keys: unknown): Promise<void>;
  load(): Promise<{ creds: unknown; keys: unknown } | null>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
  backup(): Promise<void>;
}

export async function createSessionStore(config: EnvConfig, logger: Logger): Promise<SessionStore> {
  switch (config.sessionStore) {
    case 'file':
      return createFileStore(config, logger);
    case 'redis':
      return createRedisStore(config, logger);
    case 'postgres':
      return createPostgresStore(config, logger);
    default:
      throw new Error(
        `Unknown session store "${config.sessionStore}". Supported values: postgres, redis`,
      );
    }
}

export async function createScopedSessionStore(
  config: EnvConfig,
  sessionId: string,
  logger: Logger,
  sharedSql?: postgres.Sql,
): Promise<SessionStore> {
  switch (config.sessionStore) {
    case 'file': {
      const { FileStore } = await import('./file-store');
      return new FileStore(config, logger, { instanceName: sessionId });
    }
    case 'redis': {
      const { RedisStore } = await import('./redis-store');
      return new RedisStore(config, logger, { instanceName: sessionId });
    }
    case 'postgres': {
      const { PostgresStore } = await import('./postgres-store');
      return new PostgresStore(config, logger, { sharedSql, instanceName: sessionId });
    }
    default:
      throw new Error(
        `Unknown session store "${config.sessionStore}". Supported values: postgres, redis, file`,
      );
  }
}

async function createFileStore(config: EnvConfig, logger: Logger): Promise<SessionStore> {
  const { FileStore } = await import('./file-store');
  return new FileStore(config, logger);
}

async function createRedisStore(config: EnvConfig, logger: Logger): Promise<SessionStore> {
  const { RedisStore } = await import('./redis-store');
  return new RedisStore(config, logger);
}

async function createPostgresStore(config: EnvConfig, logger: Logger): Promise<SessionStore> {
  const { PostgresStore } = await import('./postgres-store');
  return new PostgresStore(config, logger);
}
