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

  const initialCreds: Record<string, unknown> = existing
    ? hydrate(existing.creds as Record<string, unknown>)
    : (initAuthCreds() as unknown as Record<string, unknown>);
  const keyData: Record<string, unknown> = hydrate((existing?.keys as Record<string, unknown>) ?? {});

  // Contenedor mutable: los saves leen creds/keys frescos aquí en cada flush,
  // así reasignaciones de `state.creds` (baileys, tests) se persisten correctamente.
  const box: { creds: Record<string, unknown>; keys: Record<string, unknown> } = {
    creds: initialCreds,
    keys: keyData,
  };

  if (existing) {
    logger.info('Auth state loaded from store');
  } else {
    logger.info('Generated fresh authentication credentials');
  }

  // Coalescing writer: al menos un save posterior siempre corre, pero saves
  // consecutivos mientras uno está en vuelo se fusionan en una única escritura
  // final que ve el estado más reciente (no se pierde nada, no se martillea).
  let inFlight: Promise<void> | null = null;
  let pending: Promise<void> | null = null;

  function enqueueSave(): Promise<void> {
    if (pending) return pending;
    if (inFlight) {
      pending = inFlight.then(async () => {
        pending = null;
        await runSave();
      });
      return pending;
    }
    return runSave();
  }

  async function runSave(): Promise<void> {
    const task = (async () => {
      try {
        await sessionStore.save(box.creds, box.keys);
      } catch (err) {
        logger.error('Failed to save auth state', { error: String(err) });
      }
    })();
    inFlight = task;
    try {
      await task;
    } finally {
      if (inFlight === task) inFlight = null;
    }
  }

  const keys = {
    async get(type: string, ids: string[]): Promise<Record<string, unknown>> {
      const kd = box.keys;
      if (ids.length === 0) return kd;

      const result: Record<string, unknown> = {};

      const typeData = kd[type];
      if (typeof typeData === 'object' && typeData !== null) {
        for (const id of ids) {
          const val = (typeData as Record<string, unknown>)[id];
          if (val !== undefined) result[id] = val;
        }
        if (Object.keys(result).length > 0) return result;
      }

      for (const id of ids) {
        const key = `${type}-${id}`;
        if (key in kd) result[id] = kd[key];
        if (id in kd) result[id] = kd[id];
      }

      return result;
    },

    async set(data: Record<string, unknown>): Promise<void> {
      const kd = box.keys;
      for (const [k, v] of Object.entries(data)) {
        const existing = kd[k];
        if (typeof v === 'object' && v !== null && !Array.isArray(v) && typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
          Object.assign(existing, v);
        } else {
          kd[k] = v;
        }
      }
      // Baileys no siempre emite creds.update tras keys.set; encolamos un flush
      // para no depender de ese evento y evitar perder claves entre reinicios.
      enqueueSave();
    },
  };

  const state: AuthState & { save: () => Promise<void> } = {
    get creds() { return box.creds; },
    set creds(v: Record<string, unknown>) { box.creds = v; },

    keys,

    async save(): Promise<void> {
      await enqueueSave();
    },

    get _keyData() { return box.keys; },
    set _keyData(v: Record<string, unknown>) { box.keys = v; },
  };

  return state;
}

export async function createAuthProvider(
  sessionStore: SessionStore,
  logger: Logger,
): Promise<AuthProvider> {
  const state = await buildState(sessionStore, logger);
  let valid = true;

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
      if (!valid) return;
      await state.save();
    },
  };
}
