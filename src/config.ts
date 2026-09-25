import 'dotenv/config';
import type { EnvConfig } from './types';

export function loadConfig(): EnvConfig {
  const instanceName = process.env.WA_INSTANCE_NAME || 'default';

  return {
    instanceName,
    maxSessions: parseInt(process.env.WACORE_MAX_SESSIONS || '50', 10),
    healthPort: parseInt(process.env.HEALTH_PORT || '9877', 10),
    apiPort: parseInt(process.env.API_PORT || '9878', 10),
    logLevel: (process.env.LOG_LEVEL as EnvConfig['logLevel']) || 'info',
    logFormat: (process.env.LOG_FORMAT as EnvConfig['logFormat']) || (process.stdout.isTTY ? 'pretty' : 'json'),
    sessionStore: (process.env.SESSION_STORE as EnvConfig['sessionStore']) || 'postgres',
    sessionDir: process.env.SESSION_DIR || '/data/sessions',
    databaseUrl: process.env.DATABASE_URL,
    dbPoolMax: parseInt(process.env.WACORE_DB_POOL_MAX || '10', 10),
    dbStatementTimeoutMs: parseInt(process.env.WACORE_DB_STATEMENT_TIMEOUT_MS || '30000', 10),
    dbIdleTxTimeoutMs: parseInt(process.env.WACORE_DB_IDLE_TX_TIMEOUT_MS || '60000', 10),
    dbWatchdogIntervalMs: parseInt(process.env.WACORE_DB_WATCHDOG_INTERVAL_MS || '30000', 10),
    dbWatchdogMaxAgeMs: parseInt(process.env.WACORE_DB_WATCHDOG_MAX_AGE_MS || '60000', 10),
    registryTimeoutMs: parseInt(process.env.WACORE_REGISTRY_TIMEOUT_MS || '5000', 10),
    redisUrl: process.env.REDIS_URL,
    webhookUrl: process.env.WEBHOOK_URL,
    webhookSecret: process.env.WEBHOOK_SECRET,
    webhookEvents: (process.env.WEBHOOK_EVENTS || 'message').split(',').map((s: string) => s.trim()),
    webhookRetryCount: parseInt(process.env.WEBHOOK_RETRY_COUNT || '3', 10),
    webhookRetryDelay: parseInt(process.env.WEBHOOK_RETRY_DELAY || '5000', 10),
    apiKey: process.env.API_KEY,
    connectOnStartup: process.env.CONNECT_ON_STARTUP !== 'false',
    // Encendido por omisión: con una sola línea (el uso original de WACore) el registro vacío
    // significa «arranca la sesión WA_INSTANCE_NAME». Los despliegues multi-tenant lo apagan.
    legacySessionEnabled: process.env.LEGACY_SESSION_ENABLED !== 'false',
    qrTimeout: parseInt(process.env.QR_TIMEOUT || '60000', 10),
    qrMaxRounds: parseInt(process.env.QR_MAX_ROUNDS || '3', 10),
    nodeEnv: process.env.NODE_ENV || 'production',
    pollingEnabled: process.env.POLLING_ENABLED !== 'false',
    sseEnabled: process.env.SSE_ENABLED !== 'false',
    messageBufferSize: parseInt(process.env.MESSAGE_BUFFER_SIZE || '1000', 10),
    messageBufferTtlMs: parseInt(process.env.MESSAGE_BUFFER_TTL_MS || '300000', 10),
    forwardCacheMax: parseInt(process.env.FORWARD_CACHE_MAX || '5000', 10),
    forwardCacheTtlMs: parseInt(process.env.FORWARD_CACHE_TTL_MS || '86400000', 10),
    // Apagado por omisión: se enciende cuando el consumidor sabe distinguir el eco de lo
    // que él mismo envió. Así la imagen es desplegable el día uno.
    publishFromMe: process.env.WACORE_PUBLISH_FROM_ME === 'true',
    sentRegistryMax: parseInt(process.env.SENT_REGISTRY_MAX || '10000', 10),
    // Una hora: cubre de sobra el eco inmediato y la repetición que llega tras una
    // reconexión, que es cuando WhatsApp reenvía lo reciente.
    sentRegistryTtlMs: parseInt(process.env.SENT_REGISTRY_TTL_MS || '3600000', 10),
    sseHeartbeatMs: parseInt(process.env.SSE_HEARTBEAT_MS || '30000', 10),
    autoTyping: process.env.AUTO_TYPING !== 'false',
    typingDurationMs: parseInt(process.env.TYPING_DURATION_MS || '3000', 10),
    autoRead: process.env.AUTO_READ === 'true',
    // Rechazar automáticamente las llamadas entrantes. Apagado por omisión: colgarle a un
    // cliente es una decisión de negocio, y sin esto la llamada simplemente suena sin que
    // nadie la coja. El registro en la conversación se guarda igual en los dos casos.
    autoRejectCalls: process.env.AUTO_REJECT_CALLS === 'true',
    // Apagado por omisión, y a conciencia. `buttonsMessage` y `listMessage` son los formatos
    // interactivos **antiguos**: muchos clientes de WhatsApp los pintan como texto plano, y
    // en números que no son Business su uso es una de las señales que llevan al bloqueo. Se
    // enciende sabiendo lo que se hace, por línea y con la degradación a texto puesta.
    interactiveMessages: process.env.WACORE_INTERACTIVE_MESSAGES === 'true',
    mediaDir: process.env.MEDIA_DIR || '/data/media',
    mediaAutoDownload: process.env.MEDIA_AUTO_DOWNLOAD !== 'false',
    mediaBaseUrl: process.env.MEDIA_BASE_URL || `http://localhost:${parseInt(process.env.API_PORT || '9878', 10)}`,
    historySyncEnabled: process.env.HISTORY_SYNC_ENABLED !== 'false',
    historyMax: parseInt(process.env.HISTORY_MAX || '5000', 10),
    historyBatchSize: parseInt(process.env.HISTORY_BATCH_SIZE || '200', 10),
    historyBatchDelayMs: parseInt(process.env.HISTORY_BATCH_DELAY_MS || '250', 10),
  };
}
