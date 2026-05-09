import { initAuthCreds } from 'baileys/lib/Utils/auth-utils.js';
import type { Logger } from '../utils/logger';
import type { SessionStore } from '../storage/session-store';

function reviveBuffers(_key: string, value: unknown): unknown {
  if (typeof value === 'object' && value !== null && (value as Record<string, unknown>).type === 'Buffer') {
    const v = value as Record<string, unknown>;
    if (typeof v.data === 'string') return Buffer.from(v.data, 'base64');
    if (Array.isArray(v.data)) return Buffer.from(v.data as number[]);
  }
  return value;
}

export interface AuthState {
  creds: Record<string, unknown>;
  keys: {
    get: (type: string, ids: string[]) => Promise<Record<string, unknown>>;
    set: (data: Record<string, unknown>) => Promise<void>;
  };
  _keyData?: Record<string, unknown>;
}

export interface AuthProvider {
  state: AuthState & { save: () => Promise<void> };
  saveCreds: () => Promise<void>;
  invalidate: () => void;
  reset: () => void;
}

function hydrate<T>(data: T): T {
  return JSON.parse(JSON.stringify(data), reviveBuffers);
}

async function buildState(sessionStore: SessionStore, logger: Logger): Promise<AuthState & { save: () => Promise<void> }> {
  const existing = await sessionStore.load();

  const creds: Record<string, unknown> = existing
    ? hydrate(existing.creds as Record<string, unknown>)
    : (initAuthCreds() as unknown as Record<string, unknown>);
  const keyData: Record<string, unknown> = hydrate((existing?.keys as Record<string, unknown>) ?? {});

  if (existing) {
    logger.info('Auth state loaded from store');
  } else {
    logger.info('Generated fresh authentication credentials');
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

    _keyData: keyData,
  };
}

export async function createAuthProvider(
  sessionStore: SessionStore,
  logger: Logger,
): Promise<AuthProvider> {
  const state = await buildState(sessionStore, logger);
  let saveScheduled = false;
  let valid = true;

  async function persist(): Promise<void> {
    const allKeys = await state.keys.get('', []);
    await sessionStore.save(state.creds, allKeys);
  }

  return {
    state,

    invalidate() {
      valid = false;
    },

    reset() {
      valid = true;
      const fresh = initAuthCreds() as unknown as Record<string, unknown>;
      Object.keys(state.creds).forEach(k => delete state.creds[k]);
      Object.assign(state.creds, fresh);
      const keyData = state._keyData;
      if (keyData) {
        Object.keys(keyData).forEach(k => delete keyData[k]);
      }
    },

    async saveCreds() {
      if (!valid || saveScheduled) return;
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
