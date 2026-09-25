import { describe, expect, it, mock } from 'bun:test';
import { createAuthProvider } from '../baileys/auth';
import { createLogger } from '../utils/logger';
import type { SessionStore } from '../storage/session-store';

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

function createMockStore(hasData: boolean): SessionStore {
  return {
    save: mock(async () => {}),
    load: mock(async () => hasData ? { creds: { registrationId: 1 }, keys: { preKeys: [] } } : null),
    delete: mock(async () => {}),
    exists: mock(async () => hasData),
    backup: mock(async () => {}),
  };
}

describe('AuthProvider', () => {
  it('loads existing state from store', async () => {
    const store = createMockStore(true);
    const provider = await createAuthProvider(store, logger);
    expect(provider.state.creds).toEqual({ registrationId: 1 });
    expect(store.load).toHaveBeenCalledTimes(1);
  });

  it('generates fresh creds when no existing data', async () => {
    const store = createMockStore(false);
    const provider = await createAuthProvider(store, logger);
    expect(provider.state.creds.registrationId).toBeDefined();
    expect(provider.state.creds.noiseKey).toBeDefined();
    expect(typeof provider.state.keys.get).toBe('function');
    expect(typeof provider.state.keys.set).toBe('function');
  });

  it('coalesces rapid saveCreds calls to at most one follow-up write', async () => {
    // Contrato: mientras un save está en vuelo, los saves siguientes se
    // fusionan en UN único save posterior — nunca se descartan silenciosamente.
    // Máximo esperado: 2 escrituras (la en vuelo + una de seguimiento).
    const store = createMockStore(false);
    const provider = await createAuthProvider(store, logger);

    provider.saveCreds();
    provider.saveCreds();
    provider.saveCreds();
    await provider.saveCreds();

    const calls = (store.save as any).mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);
  });

  it('calls sessionStore.save with current state', async () => {
    const store = createMockStore(false);
    const provider = await createAuthProvider(store, logger);

    provider.state.creds = { registrationId: 42 };
    await provider.saveCreds();

    expect(store.save).toHaveBeenCalledWith({ registrationId: 42 }, {});
  });

  it('handles save errors gracefully', async () => {
    const store = createMockStore(false);
    store.save = mock(async () => { throw new Error('write error'); });
    const provider = await createAuthProvider(store, logger);

    await expect(provider.saveCreds()).resolves.toBeUndefined();
  });
});
