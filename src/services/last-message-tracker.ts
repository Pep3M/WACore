export interface MinimalKey {
  remoteJid: string;
  id: string;
  fromMe: boolean;
}

export interface TrackedMessage {
  key: MinimalKey;
  messageTimestamp: number;
}

export interface LastMessageTracker {
  remember(chatJid: string, msg: TrackedMessage): void;
  get(chatJid: string): TrackedMessage | undefined;
  size(): number;
  clear(): void;
}

export interface LastMessageTrackerOptions {
  /** Cuántos chats distintos se recuerdan antes de tirar el más viejo. */
  max: number;
}

/**
 * El último mensaje recibido de cada conversación.
 *
 * Existe por una exigencia de Baileys que no se puede rodear: `archive`, `markRead`, `delete` y
 * `clear` son parches de app-state y **necesitan `lastMessages`**, cuyo último elemento tiene que
 * ser el último mensaje recibido de verdad en ese chat. WACore no tiene almacén de chats, así que
 * sin este registro no habría forma de construirlo.
 *
 * Lo que lo hace importante de verdad: **un `lastMessages` equivocado no falla**. WhatsApp acepta
 * el parche y simplemente no hace nada. Es peor que un error, porque el llamante recibe un 200 y
 * se queda convencido de que archivó la conversación. Por eso quien no tenga el dato debe recibir
 * un 400 en la puerta en lugar de un parche a ciegas.
 *
 * Se guarda solo lo mínimo (clave y hora), no el mensaje: esto no es una caché de contenido.
 */
export function createLastMessageTracker(opts: LastMessageTrackerOptions): LastMessageTracker {
  const max = Math.max(1, opts.max);
  // Map conserva el orden de inserción → el primero es el más viejo cuando toca desalojar.
  const store = new Map<string, TrackedMessage>();

  return {
    remember(chatJid: string, msg: TrackedMessage): void {
      if (!chatJid || !msg?.key?.id) return;

      const previo = store.get(chatJid);
      // Llegan repeticiones y reenvíos tras una reconexión: si uno viejo pisara al reciente,
      // el parche se construiría con el mensaje equivocado y no haría nada en silencio.
      if (previo && previo.messageTimestamp > msg.messageTimestamp) return;

      store.delete(chatJid);
      store.set(chatJid, msg);

      while (store.size > max) {
        const primero = store.keys().next().value;
        if (primero === undefined) break;
        store.delete(primero);
      }
    },

    get(chatJid: string): TrackedMessage | undefined {
      return store.get(chatJid);
    },

    size(): number {
      return store.size;
    },

    clear(): void {
      store.clear();
    },
  };
}
