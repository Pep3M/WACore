import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from './session-store';

export class RedisStore implements SessionStore {
  constructor(config: EnvConfig, logger: Logger) {
    logger.info('RedisStore selected', { redisUrl: config.redisUrl });
  }

  async exists(): Promise<boolean> {
    throw new Error('RedisStore not yet implemented');
  }

  async load(): Promise<{ creds: unknown; keys: unknown } | null> {
    throw new Error('RedisStore not yet implemented');
  }

  async save(_creds: unknown, _keys: unknown): Promise<void> {
    throw new Error('RedisStore not yet implemented');
  }

  async delete(): Promise<void> {
    throw new Error('RedisStore not yet implemented');
  }

  async backup(): Promise<void> {
    throw new Error('RedisStore not yet implemented');
  }
}
