import type { Logger } from '../utils/logger';
import type { SessionStore } from '../storage/session-store';

export interface AuthState {
  creds: Record<string, unknown>;
  keys: {
    get: (type: string, ids: string[]) => Promise<Record<string, unknown>>;
    set: (data: Record<string, unknown>) => Promise<void>;
  };
}

export interface AuthProvider {
  state: AuthState & { save: () => Promise<void> };
  saveCreds: () => Promise<void>;
}

async function buildState(sessionStore: SessionStore, logger: Logger): Promise<AuthState & { save: () => Promise<void> }> {
  const existing = await sessionStore.load();
  const creds: Record<string, unknown> = (existing?.creds as Record<string, unknown>) ?? {};
  const keyData: Record<string, unknown> = (existing?.keys as Record<string, unknown>) ?? {};

  if (existing) {
    logger.info('Auth state loaded from store');
  } else {
    logger.info('No existing auth state, will generate new credentials');
  }

  let persistQueue: Promise<void> = Promise.resolve();

  function enqueueSave(): void {
    persistQueue = persistQueue.then(async () => {
      try {
        await sessionStore.save(creds, keyData);
      } catch (err) {
        logger.error('Failed to save auth state', { error: String(err) });
      }
    });
  }

  const keys = {
    async get(type: string, ids: string[]): Promise<Record<string, unknown>> {
      if (ids.length === 0) return keyData;
      const result: Record<string, unknown> = {};
      for (const id of ids) {
        const key = `${type}-${id}`;
        if (key in keyData) result[id] = keyData[key];
        if (id in keyData) result[id] = keyData[id];
      }
      return result;
    },

    async set(data: Record<string, unknown>): Promise<void> {
      Object.assign(keyData, data);
    },
  };

  return {
    creds,

    keys,

    async save(): Promise<void> {
      enqueueSave();
      await persistQueue;
    },
  };
}

export async function createAuthProvider(
  sessionStore: SessionStore,
  logger: Logger,
): Promise<AuthProvider> {
  const state = await buildState(sessionStore, logger);
  let saveScheduled = false;

  async function persist(): Promise<void> {
    const allKeys = await state.keys.get('', []);
    await sessionStore.save(state.creds, allKeys);
  }

  return {
    state,

    async saveCreds() {
      if (saveScheduled) return;
      saveScheduled = true;

      await Promise.resolve();
      saveScheduled = false;

      try {
        await persist();
      } catch (err) {
        logger.error('Failed to save auth state', { error: String(err) });
      }
    },
  };
}
