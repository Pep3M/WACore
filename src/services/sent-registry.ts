/**
 * Recuerda qué mensajes salieron por la API para reconocer su eco.
 *
 * WhatsApp devuelve por `messages.upsert` una copia de todo lo que sale de la línea,
 * escriba quien escriba: el consumidor por la API o una persona desde el móvil. Las dos copias
 * son indistinguibles mirando el mensaje —mismo `fromMe`, mismo formato de id—, y la
 * diferencia importa mucho: la del consumidor ya está guardada y volver a procesarla duplicaría
 * la conversación; la del móvil no existe en ninguna parte y hay que ingerirla.
 *
 * De ahí este registro: al enviar se apunta la clave `{remoteJid, id}` y, cuando llega el
 * eco, la presencia de esa clave es una comparación exacta contra lo que enviamos nosotros,
 * no una heurística sobre la forma del identificador.
 *
 * Es deliberadamente distinto de {@link ./raw-message-cache}, que guarda el mensaje entero
 * para poder reenviarlo y se llena **también** con lo que entra. Mezclarlos haría que todo
 * mensaje pareciese nuestro.
 */

export interface SentRegistryOptions {
  ttlMs: number;
  max: number;
}

export interface SentRegistry {
  remember(remoteJid: string, id: string): void;
  has(remoteJid: string, id: string): boolean;
  size(): number;
  clear(): void;
}

export function createSentRegistry(opts: SentRegistryOptions): SentRegistry {
  const ttlMs = Math.max(1, opts.ttlMs);
  const max = Math.max(1, opts.max);
  // Map conserva el orden de inserción → el primero es el más viejo cuando toca desalojar.
  const store = new Map<string, number>();

  function keyOf(remoteJid: string, id: string): string {
    return `${remoteJid}::${id}`;
  }

  function evictOverflow(): void {
    while (store.size > max) {
      const first = store.keys().next().value;
      if (first === undefined) break;
      store.delete(first);
    }
  }

  return {
    remember(remoteJid: string, id: string): void {
      if (!remoteJid || !id) return;
      const k = keyOf(remoteJid, id);
      // Reinsertar lo mueve al final (lo más reciente).
      store.delete(k);
      store.set(k, Date.now() + ttlMs);
      evictOverflow();
    },

    has(remoteJid: string, id: string): boolean {
      if (!remoteJid || !id) return false;
      const k = keyOf(remoteJid, id);
      const expiresAt = store.get(k);
      if (expiresAt === undefined) return false;
      if (expiresAt <= Date.now()) {
        store.delete(k);
        return false;
      }
      // No se borra al consultarlo: WhatsApp puede repetir el eco (una reconexión
      // reenvía lo reciente) y la segunda copia también es nuestra.
      return true;
    },

    size(): number {
      const now = Date.now();
      for (const [k, expiresAt] of store) {
        if (expiresAt > now) break;
        store.delete(k);
      }
      return store.size;
    },

    clear(): void {
      store.clear();
    },
  };
}
