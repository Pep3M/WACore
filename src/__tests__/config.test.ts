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
    expect(config.sessionStore).toBe('file');
    expect(config.sessionDir).toBe('/data/sessions');
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

  it('throws when WA_INSTANCE_NAME is missing', () => {
    delete Bun.env.WA_INSTANCE_NAME;
    expect(() => loadConfig()).toThrow('WA_INSTANCE_NAME es requerida');
  });
});
