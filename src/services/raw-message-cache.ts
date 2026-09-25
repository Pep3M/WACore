export interface RawWAMessage {
  key?: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null; participant?: string | null };
  message?: unknown;
  [k: string]: unknown;
}

export interface RawMessageCacheOptions {
  ttlMs: number;
  max: number;
}

export interface RawMessageCache {
  put(msg: RawWAMessage): void;
  get(remoteJid: string, id: string): RawWAMessage | undefined;
  size(): number;
  clear(): void;
}

interface Entry {
  msg: RawWAMessage;
  expiresAt: number;
}

export function createRawMessageCache(opts: RawMessageCacheOptions): RawMessageCache {
  const ttlMs = Math.max(1, opts.ttlMs);
  const max = Math.max(1, opts.max);
  // Map preserves insertion order → oldest is first when we need to evict.
  const store = new Map<string, Entry>();

  function keyOf(remoteJid: string, id: string): string {
    return `${remoteJid}::${id}`;
  }

  function evictExpired(now: number): void {
    for (const [k, entry] of store) {
      if (entry.expiresAt > now) break;
      store.delete(k);
    }
  }

  function evictOverflow(): void {
    while (store.size > max) {
      const first = store.keys().next().value;
      if (first === undefined) break;
      store.delete(first);
    }
  }

  return {
    put(msg: RawWAMessage): void {
      const remoteJid = msg.key?.remoteJid ?? '';
      const id = msg.key?.id ?? '';
      if (!remoteJid || !id) return;
      const k = keyOf(remoteJid, id);
      // Re-insert to move to the end (most recent).
      store.delete(k);
      store.set(k, { msg, expiresAt: Date.now() + ttlMs });
      evictOverflow();
    },

    get(remoteJid: string, id: string): RawWAMessage | undefined {
      const k = keyOf(remoteJid, id);
      const entry = store.get(k);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(k);
        return undefined;
      }
      return entry.msg;
    },

    size(): number {
      evictExpired(Date.now());
      return store.size;
    },

    clear(): void {
      store.clear();
    },
  };
}
