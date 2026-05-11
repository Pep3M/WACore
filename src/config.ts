import 'dotenv/config';
import type { EnvConfig } from './types';

export function loadConfig(): EnvConfig {
  const instanceName = process.env.WA_INSTANCE_NAME;
  if (!instanceName) {
    throw new Error('WA_INSTANCE_NAME es requerida');
  }

  return {
    instanceName,
    healthPort: parseInt(process.env.HEALTH_PORT || '9877', 10),
    apiPort: parseInt(process.env.API_PORT || '9878', 10),
    logLevel: (process.env.LOG_LEVEL as EnvConfig['logLevel']) || 'info',
    sessionStore: (process.env.SESSION_STORE as EnvConfig['sessionStore']) || 'postgres',
    sessionDir: process.env.SESSION_DIR || '/data/sessions',
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    webhookUrl: process.env.WEBHOOK_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
    webhookEvents: (process.env.WEBHOOK_EVENTS || 'message').split(',').map((s: string) => s.trim()),
    webhookRetryCount: parseInt(process.env.WEBHOOK_RETRY_COUNT || '3', 10),
    webhookRetryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY || '5000', 10),
    apiKey: process.env.API_KEY,
    connectOnStartup: process.env.CONNECT_ON_STARTUP !== 'false',
    qrTimeout: parseInt(process.env.QR_TIMEOUT || '60000', 10),
    nodeEnv: process.env.NODE_ENV || 'production',
    pollingEnabled: process.env.POLLING_ENABLED !== 'false',
    sseEnabled: process.env.SSE_ENABLED !== 'false',
    messageBufferSize: parseInt(process.env.MESSAGE_BUFFER_SIZE || '1000', 10),
    messageBufferTtlMs: parseInt(process.env.MESSAGE_BUFFER_TTL_MS || '300000', 10),
    sseHeartbeatMs: parseInt(process.env.SSE_HEARTBEAT_MS || '30000', 10),
    autoTyping: process.env.AUTO_TYPING !== 'false',
    typingDurationMs: parseInt(process.env.TYPING_DURATION_MS || '3000', 10),
    autoRead: process.env.AUTO_READ === 'true',
    mediaDir: process.env.MEDIA_DIR || '/data/media',
    mediaAutoDownload: process.env.MEDIA_AUTO_DOWNLOAD !== 'false',
    mediaBaseUrl: process.env.MEDIA_BASE_URL || `http://localhost:${parseInt(process.env.API_PORT || '9878', 10)}`,
  };
}
