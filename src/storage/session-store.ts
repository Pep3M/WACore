import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';

export interface SessionStore {
  save(creds: unknown, keys: unknown): Promise<void>;
  load(): Promise<{ creds: unknown; keys: unknown } | null>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
  backup(): Promise<void>;
}

export function createSessionStore(config: EnvConfig, logger: Logger): SessionStore {
  switch (config.sessionStore) {
    case 'file':
      return createFileStore(config, logger);
    case 'redis':
      return createRedisStore(config, logger);
    default:
      logger.warn(`Unknown session store "${config.sessionStore}", falling back to file`);
      return createFileStore(config, logger);
    }
}

function createFileStore(config: EnvConfig, logger: Logger): SessionStore {
  const { FileStore } = require('./file-store');
  return new FileStore(config, logger);
}

function createRedisStore(config: EnvConfig, logger: Logger): SessionStore {
  const { RedisStore } = require('./redis-store');
  return new RedisStore(config, logger);
}
