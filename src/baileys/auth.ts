import type { Logger } from '../utils/logger';
import type { SessionStore } from '../storage/session-store';

export interface BaileysAuthState {
  creds: Record<string, unknown>;
  keys: Record<string, unknown>;
  get: (type: string, ids: string[]) => Promise<Record<string, unknown>>;
  set: (data: Record<string, unknown>) => Promise<void>;
  save: () => Promise<void>;
}

export interface AuthProvider {
  state: BaileysAuthState;
  saveCreds: () => Promise<void>;
}

async function buildState(sessionStore: SessionStore, logger: Logger): Promise<BaileysAuthState> {
  const existing = await sessionStore.load();
  const creds: Record<string, unknown> = (existing?.creds as Record<string, unknown>) ?? {};
  const keys: Record<string, unknown> = (existing?.keys as Record<string, unknown>) ?? {};

  if (existing) {
    logger.info('Auth state loaded from store');
  } else {
    logger.info('No existing auth state, will generate new credentials');
  }

  let persistQueue: Promise<void> = Promise.resolve();

  function enqueueSave(): void {
    persistQueue = persistQueue.then(async () => {
      try {
        await sessionStore.save(creds, keys);
      } catch (err) {
        logger.error('Failed to save auth state', { error: String(err) });
      }
    });
  }

  return {
    creds,
    keys,

    async get(type: string, ids: string[]): Promise<Record<string, unknown>> {
      if (type === 'creds') return creds;
      if (type === 'keys') {
        if (ids.length === 0) return keys;
        const result: Record<string, unknown> = {};
        for (const id of ids) {
          if (id in keys) result[id] = keys[id];
        }
        return result;
      }
      return {};
    },

    async set(data: Record<string, unknown>): Promise<void> {
      if (typeof data.creds === 'object' && data.creds !== null) {
        Object.assign(creds, data.creds);
      }
      for (const [k, v] of Object.entries(data)) {
        if (k !== 'creds') {
          keys[k] = v;
        }
      }
    },

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

  return {
    state,

    async saveCreds() {
      if (saveScheduled) return;
      saveScheduled = true;

      await Promise.resolve();
      saveScheduled = false;

      try {
        await sessionStore.save(state.creds, state.keys);
      } catch (err) {
        logger.error('Failed to save auth state', { error: String(err) });
      }
    },
  };
}
