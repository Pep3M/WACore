import { describe, expect, it } from 'bun:test';
import { createReconnectionManager } from '../core/reconnection';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};
const logger = createLogger(mockConfig);

describe('ReconnectionManager', () => {
  it('starts with attempt 0', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.getAttempt()).toBe(0);
  });

  it('should reconnect for recoverable reasons', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.shouldReconnect('timedOut')).toBe(true);
    expect(rm.shouldReconnect('connectionReplaced')).toBe(true);
    expect(rm.shouldReconnect('unavailableService')).toBe(true);
    expect(rm.shouldReconnect('restartRequired')).toBe(true);
  });

  it('should not reconnect for terminal reasons', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.shouldReconnect('loggedOut')).toBe(false);
    expect(rm.shouldReconnect('multidevice')).toBe(false);
    expect(rm.shouldReconnect('forbidden')).toBe(false);
  });

  it('increments attempt on recordFailure', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    rm.recordFailure('timedOut');
    expect(rm.getAttempt()).toBe(1);
    rm.recordFailure('timedOut');
    expect(rm.getAttempt()).toBe(2);
  });

  it('resets attempt to 0', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    rm.recordFailure('timedOut');
    rm.recordFailure('timedOut');
    rm.reset();
    expect(rm.getAttempt()).toBe(0);
  });

  // Este test afirmaba lo contrario —que tras 10 intentos se dejaba de reconectar— y describía
  // un bug, no un requisito: el 2026-08-26 un corte de DNS de menos de tres minutos agotó los 15
  // intentos de `timedOut` y dejó una línea muerta pidiendo QR, con las credenciales intactas.
  // Una caída de red se arregla sola; rendirse garantiza que nadie vuelva a intentarlo.
  it('never gives up on a network failure, however long it lasts', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    for (let i = 0; i < 500; i++) rm.recordFailure('connectionReplaced');
    expect(rm.shouldReconnect('connectionReplaced')).toBe(true);

    const otro = createReconnectionManager(createEventBus(), logger);
    for (let i = 0; i < 500; i++) otro.recordFailure('timedOut');
    expect(otro.shouldReconnect('timedOut')).toBe(true);
  });

  // La regresión exacta del incidente: `getaddrinfo ENOTFOUND web.whatsapp.com` llega como 408,
  // que Baileys mapea a `timedOut`. Quince fallos seguidos no pueden ser el final del camino.
  it('survives the outage that killed a line: 15 consecutive timedOut', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    for (let i = 0; i < 15; i++) {
      expect(rm.shouldReconnect('timedOut')).toBe(true);
      rm.recordFailure('timedOut');
    }
    expect(rm.shouldReconnect('timedOut')).toBe(true);
    expect(rm.isExhausted('timedOut')).toBe(true);
  });

  it('slows down instead of stopping once the quick attempts run out', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    for (let i = 0; i < 15; i++) rm.recordFailure('timedOut');
    // La cadencia sostenida es de un minuto, con jitter de la mitad hacia arriba.
    const delay = rm.getDelay('timedOut');
    expect(delay).toBeGreaterThanOrEqual(30_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it('still gives up when only a human with the phone can fix it', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.shouldReconnect('loggedOut')).toBe(false);

    // `badSession` tiene dos oportunidades por si fue un tropiezo al leer las credenciales;
    // después hace falta emparejar de nuevo.
    const corrupta = createReconnectionManager(createEventBus(), logger);
    expect(corrupta.shouldReconnect('badSession')).toBe(true);
    corrupta.recordFailure('badSession');
    corrupta.recordFailure('badSession');
    expect(corrupta.shouldReconnect('badSession')).toBe(false);
  });

  it('treats an unknown reason as transient', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    for (let i = 0; i < 100; i++) rm.recordFailure('unknown');
    expect(rm.shouldReconnect('unknown')).toBe(true);
  });

  it('is not exhausted while the quick attempts remain', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    expect(rm.isExhausted('timedOut')).toBe(false);
    rm.recordFailure('timedOut');
    expect(rm.isExhausted('timedOut')).toBe(false);
  });

  it('reconnecting successfully clears the exhausted state', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    for (let i = 0; i < 20; i++) rm.recordFailure('timedOut');
    expect(rm.isExhausted('timedOut')).toBe(true);
    rm.reset();
    expect(rm.isExhausted('timedOut')).toBe(false);
    expect(rm.getDelay('timedOut')).toBeLessThan(30_000);
  });

  it('returns delay based on backoff config', () => {
    const rm = createReconnectionManager(createEventBus(), logger);
    const delay = rm.getDelay('timedOut');
    expect(delay).toBeGreaterThan(0);
  });
});
