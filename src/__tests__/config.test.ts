import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { loadConfig } from '../config';

const originalEnv = { ...Bun.env };

describe('loadConfig', () => {
  beforeEach(() => {
    Bun.env.WA_INSTANCE_NAME = 'test-bot';
    Bun.env.HEALTH_PORT = '9877';
    Bun.env.API_PORT = '9878';
    Bun.env.LOG_LEVEL = 'debug';
    Bun.env.SESSION_STORE = 'file';
    Bun.env.SESSION_DIR = '/data/sessions';
    Bun.env.CONNECT_ON_STARTUP = 'true';
    Bun.env.QR_TIMEOUT = '60000';
    Bun.env.NODE_ENV = 'development';
    Bun.env.WEBHOOK_EVENTS = 'message,connection';
    Bun.env.WEBHOOK_RETRY_COUNT = '3';
    Bun.env.WEBHOOK_RETRY_DELAY = '5000';
  });

  afterEach(() => {
    Object.assign(Bun.env, originalEnv);
  });

  it('loads all config values from env', () => {
    const config = loadConfig();
    expect(config.instanceName).toBe('test-bot');
    expect(config.healthPort).toBe(9877);
    expect(config.apiPort).toBe(9878);
    expect(config.logLevel).toBe('debug');
    expect(config.sessionStore).toBe('file');
    expect(config.sessionDir).toBe('/data/sessions');
    expect(config.connectOnStartup).toBe(true);
    expect(config.qrTimeout).toBe(60000);
    expect(config.nodeEnv).toBe('development');
    expect(config.webhookEvents).toEqual(['message', 'connection']);
    expect(config.webhookRetryCount).toBe(3);
    expect(config.webhookRetryDelay).toBe(5000);
  });

  it('uses defaults when env vars are not set', () => {
    delete Bun.env.HEALTH_PORT;
    delete Bun.env.API_PORT;
    delete Bun.env.LOG_LEVEL;
    delete Bun.env.SESSION_STORE;
    delete Bun.env.SESSION_DIR;
    delete Bun.env.CONNECT_ON_STARTUP;
    delete Bun.env.QR_TIMEOUT;
    delete Bun.env.NODE_ENV;
    delete Bun.env.WEBHOOK_EVENTS;
    delete Bun.env.WEBHOOK_RETRY_COUNT;
    delete Bun.env.WEBHOOK_RETRY_DELAY;

    const config = loadConfig();
    expect(config.healthPort).toBe(9877);
    expect(config.apiPort).toBe(9878);
    expect(config.logLevel).toBe('info');
    expect(config.sessionStore).toBe('postgres');
    expect(config.connectOnStartup).toBe(true);
    expect(config.qrTimeout).toBe(60000);
    expect(config.nodeEnv).toBe('production');
    expect(config.webhookEvents).toEqual(['message']);
    expect(config.webhookRetryCount).toBe(3);
    expect(config.webhookRetryDelay).toBe(5000);
  });

  it('parses boolean connectOnStartup correctly', () => {
    Bun.env.CONNECT_ON_STARTUP = 'false';
    expect(loadConfig().connectOnStartup).toBe(false);
  });

  it('loads pollingEnabled default as true', () => {
    delete Bun.env.POLLING_ENABLED;
    expect(loadConfig().pollingEnabled).toBe(true);
  });

  it('POLLING_ENABLED=false disables polling', () => {
    Bun.env.POLLING_ENABLED = 'false';
    expect(loadConfig().pollingEnabled).toBe(false);
    delete Bun.env.POLLING_ENABLED;
  });

  it('loads legacySessionEnabled default as true, LEGACY_SESSION_ENABLED=false disables it', () => {
    delete Bun.env.LEGACY_SESSION_ENABLED;
    expect(loadConfig().legacySessionEnabled).toBe(true);
    Bun.env.LEGACY_SESSION_ENABLED = 'false';
    expect(loadConfig().legacySessionEnabled).toBe(false);
    delete Bun.env.LEGACY_SESSION_ENABLED;
  });

  it('loads sseEnabled default as true', () => {
    delete Bun.env.SSE_ENABLED;
    expect(loadConfig().sseEnabled).toBe(true);
  });

  it('loads messageBufferSize default', () => {
    delete Bun.env.MESSAGE_BUFFER_SIZE;
    expect(loadConfig().messageBufferSize).toBe(1000);
  });

  it('loads messageBufferTtlMs default', () => {
    delete Bun.env.MESSAGE_BUFFER_TTL_MS;
    expect(loadConfig().messageBufferTtlMs).toBe(300000);
  });

  it('loads sseHeartbeatMs default', () => {
    delete Bun.env.SSE_HEARTBEAT_MS;
    expect(loadConfig().sseHeartbeatMs).toBe(30000);
  });

  it('parses pollingEnabled from env', () => {
    Bun.env.POLLING_ENABLED = 'true';
    expect(loadConfig().pollingEnabled).toBe(true);
  });

  it('parses sseEnabled from env', () => {
    Bun.env.SSE_ENABLED = 'true';
    expect(loadConfig().sseEnabled).toBe(true);
  });

  it('loads media config defaults', () => {
    delete Bun.env.MEDIA_DIR;
    delete Bun.env.MEDIA_AUTO_DOWNLOAD;
    delete Bun.env.MEDIA_BASE_URL;
    const config = loadConfig();
    expect(config.mediaDir).toBe('/data/media');
    expect(config.mediaAutoDownload).toBe(true);
    expect(config.mediaBaseUrl).toBe('http://localhost:9878');
  });

  it('parses media env vars', () => {
    Bun.env.MEDIA_DIR = '/custom/media';
    Bun.env.MEDIA_AUTO_DOWNLOAD = 'false';
    Bun.env.MEDIA_BASE_URL = 'http://cdn.example.com';
    const config = loadConfig();
    expect(config.mediaDir).toBe('/custom/media');
    expect(config.mediaAutoDownload).toBe(false);
    expect(config.mediaBaseUrl).toBe('http://cdn.example.com');
  });

  it('defaults instanceName to "default" when WA_INSTANCE_NAME is missing', () => {
    delete Bun.env.WA_INSTANCE_NAME;
    expect(loadConfig().instanceName).toBe('default');
  });

  /**
   * Los plazos de la base de datos. El pool nacía con `max: 3` y sin ningún plazo, y esa
   * combinación es la que convertía una consulta atascada en «ninguna línea genera ya códigos QR».
   */
  it('trae plazos de base de datos por omisión, y el pool ya no es de 3', () => {
    delete Bun.env.WACORE_DB_POOL_MAX;
    delete Bun.env.WACORE_DB_STATEMENT_TIMEOUT_MS;
    delete Bun.env.WACORE_DB_IDLE_TX_TIMEOUT_MS;
    delete Bun.env.WACORE_DB_WATCHDOG_INTERVAL_MS;
    delete Bun.env.WACORE_DB_WATCHDOG_MAX_AGE_MS;
    delete Bun.env.WACORE_REGISTRY_TIMEOUT_MS;

    const config = loadConfig();

    expect(config.dbPoolMax).toBe(10);
    expect(config.dbStatementTimeoutMs).toBe(30000);
    expect(config.dbIdleTxTimeoutMs).toBe(60000);
    expect(config.dbWatchdogIntervalMs).toBe(30000);
    expect(config.dbWatchdogMaxAgeMs).toBe(60000);
    expect(config.registryTimeoutMs).toBe(5000);
  });

  it('deja afinar los plazos de base de datos por entorno', () => {
    Bun.env.WACORE_DB_POOL_MAX = '20';
    Bun.env.WACORE_DB_STATEMENT_TIMEOUT_MS = '15000';
    Bun.env.WACORE_DB_IDLE_TX_TIMEOUT_MS = '45000';
    Bun.env.WACORE_DB_WATCHDOG_INTERVAL_MS = '0';
    Bun.env.WACORE_DB_WATCHDOG_MAX_AGE_MS = '120000';
    Bun.env.WACORE_REGISTRY_TIMEOUT_MS = '8000';

    const config = loadConfig();

    expect(config.dbPoolMax).toBe(20);
    expect(config.dbStatementTimeoutMs).toBe(15000);
    expect(config.dbIdleTxTimeoutMs).toBe(45000);
    // `0` apaga el vigilante, así que tiene que llegar tal cual y no caer al valor por omisión.
    expect(config.dbWatchdogIntervalMs).toBe(0);
    expect(config.dbWatchdogMaxAgeMs).toBe(120000);
    expect(config.registryTimeoutMs).toBe(8000);
  });
});
