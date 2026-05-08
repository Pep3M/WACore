import type { EnvConfig } from './types';

export function loadConfig(): EnvConfig {
  const instanceName = Bun.env.WA_INSTANCE_NAME;
  if (!instanceName) {
    throw new Error('WA_INSTANCE_NAME es requerida');
  }

  return {
    instanceName,
    healthPort: parseInt(Bun.env.HEALTH_PORT || '9877', 10),
    apiPort: parseInt(Bun.env.API_PORT || '9878', 10),
    logLevel: (Bun.env.LOG_LEVEL as EnvConfig['logLevel']) || 'info',
    sessionStore: (Bun.env.SESSION_STORE as EnvConfig['sessionStore']) || 'file',
    sessionDir: Bun.env.SESSION_DIR || '/data/sessions',
    redisUrl: Bun.env.REDIS_URL,
    webhookUrl: Bun.env.WEBHOOK_URL,
    webhookSecret: Bun.env.WEBHOOK_SECRET,
    webhookEvents: (Bun.env.WEBHOOK_EVENTS || 'message').split(',').map(s => s.trim()),
    webhookRetryCount: parseInt(Bun.env.WEBHOOK_RETRY_COUNT || '3', 10),
    webhookRetryDelay: parseInt(Bun.env.WEBHOOK_RETRY_DELAY || '5000', 10),
    apiKey: Bun.env.API_KEY,
    connectOnStartup: Bun.env.CONNECT_ON_STARTUP !== 'false',
    qrTimeout: parseInt(Bun.env.QR_TIMEOUT || '60000', 10),
    nodeEnv: Bun.env.NODE_ENV || 'production',
    pollingEnabled: Bun.env.POLLING_ENABLED === 'true',
    sseEnabled: Bun.env.SSE_ENABLED !== 'false',
    messageBufferSize: parseInt(Bun.env.MESSAGE_BUFFER_SIZE || '1000', 10),
    messageBufferTtlMs: parseInt(Bun.env.MESSAGE_BUFFER_TTL_MS || '300000', 10),
    sseHeartbeatMs: parseInt(Bun.env.SSE_HEARTBEAT_MS || '30000', 10),
  };
}
