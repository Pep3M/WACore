import Redis from 'ioredis';
import { BufferJSON } from 'baileys/lib/Utils/generics.js';
import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from './session-store';

const KEY_PREFIX = 'wacore:session:';

export class RedisStore implements SessionStore {
  private redis: Redis;
  private logger: Logger;
  private instanceName: string;

  constructor(config: EnvConfig, logger: Logger) {
    this.instanceName = config.instanceName;
    this.logger = logger;
    this.redis = new Redis(config.redisUrl ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });
  }

  private credsKey(): string {
    return `${KEY_PREFIX}${this.instanceName}:creds`;
  }

  private keysKey(): string {
    return `${KEY_PREFIX}${this.instanceName}:keys`;
  }

  async exists(): Promise<boolean> {
    try {
      const count = await this.redis.exists(this.credsKey(), this.keysKey());
      return count === 2;
    } catch (err) {
      this.logger.error('Redis exists check failed', { error: String(err) });
      return false;
    }
  }

  async load(): Promise<{ creds: unknown; keys: unknown } | null> {
    try {
      const [credsJson, keysJson] = await Promise.all([
        this.redis.get(this.credsKey()),
        this.redis.get(this.keysKey()),
      ]);

      if (!credsJson || !keysJson) {
        this.logger.debug('No session data found in Redis');
        return null;
      }

      const creds = JSON.parse(credsJson, BufferJSON.reviver) as unknown;
      const keys = JSON.parse(keysJson, BufferJSON.reviver) as unknown;
      this.logger.info('Session loaded from Redis');
      return { creds, keys };
    } catch (err) {
      this.logger.error('Failed to load session from Redis', { error: String(err) });
      return null;
    }
  }

  async save(creds: unknown, keys: unknown): Promise<void> {
    try {
      const credsJson = JSON.stringify(creds, BufferJSON.replacer);
      const keysJson = JSON.stringify(keys, BufferJSON.replacer);
      await this.redis.mset(this.credsKey(), credsJson, this.keysKey(), keysJson);
      this.logger.debug('Session saved to Redis');
    } catch (err) {
      this.logger.error('Failed to save session to Redis', { error: String(err) });
    }
  }

  async delete(): Promise<void> {
    try {
      await this.redis.del(this.credsKey(), this.keysKey());
      this.logger.warn('Session deleted from Redis');
    } catch (err) {
      this.logger.error('Failed to delete session from Redis', { error: String(err) });
    }
  }

  async backup(): Promise<void> {
    try {
      await this.redis.bgsave();
      this.logger.debug('Redis RDB backup (BGSAVE) triggered');
    } catch (err) {
      this.logger.warn('Redis backup failed', { error: String(err) });
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
