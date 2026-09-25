import { describe, expect, it } from 'bun:test';
import { createSessionManager } from '../sessions/session-manager';
import { SessionRegistryUnavailableError } from '../sessions/types';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { ContactStore } from '../storage/contact-store';
import type { LabelStore } from '../storage/label-store';
import type { PostgresSessionRegistry } from '../storage/postgres-store';

/**
 * El plazo con el que se espera al registro de sesiones.
 *
 * **Esto es un arreglo, no una precaución.** `create()` espera a que la fila de la
 * sesión exista *antes* de construirla y arrancar Baileys. Mientras esa promesa no vuelva no hay
 * socket, no se emite el evento `qr` y la respuesta HTTP tampoco sale: el consumidor corta a los veinte
 * segundos y la pantalla de Conexiones se queda con un modal vacío. Una sola conexión de Postgres
 * atascada dejó así a **todas** las líneas sin poder emparejarse durante media hora.
 *
 * Se prueba con un registro que no contesta nunca porque es exactamente la avería: no es que la
 * base fuera lenta, es que la promesa no volvía jamás. Contra un Postgres de verdad eso no se
 * puede provocar.
 */

const config: EnvConfig = {
  instanceName: 'test-plazo',
  maxSessions: 10,
  healthPort: 19992,
  apiPort: 19993,
  logLevel: 'error',
  sessionStore: 'file',
  sessionDir: '/tmp/wacore-plazo',
  webhookEvents: [],
  webhookRetryCount: 0,
  webhookRetryDelay: 0,
  connectOnStartup: false,
  qrTimeout: 60000,
  nodeEnv: 'test',
  pollingEnabled: false,
  sseEnabled: false,
  messageBufferSize: 100,
  messageBufferTtlMs: 60000,
  sseHeartbeatMs: 30000,
  autoTyping: false,
  typingDurationMs: 1000,
  autoRead: false,
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:19993',
  // Corto a propósito: lo que se mide es que *hay* plazo, no cuál.
  registryTimeoutMs: 100,
};

const contactStore: ContactStore = {
  upsert: async () => {},
  upsertMany: async () => {},
  list: async () => ({ items: [], total: 0 }),
  setProfilePic: async () => {},
  mergeLid: async () => {},
  purgeSession: async () => {},
};

const labelStore: LabelStore = {
  upsertLabel: async () => {},
  listLabels: async () => [],
  getLabel: async () => null,
  addAssociation: async () => {},
  removeAssociation: async () => {},
  getAssociations: async () => ({ chats: [], messages: [] }),
};

const logger = createLogger(config);

/** Nunca resuelve: es lo que hace una conexión del pool atascada a media conversación. */
const jamas = <T>(): Promise<T> => new Promise<T>(() => {});

function registroQueNoContesta(
  sobrescribir: Partial<PostgresSessionRegistry> = {},
): PostgresSessionRegistry {
  return {
    list: async () => [],
    ensureRow: () => jamas<void>(),
    updateStatus: async () => {},
    deleteRow: async () => {},
    ...sobrescribir,
  } as unknown as PostgresSessionRegistry;
}

function gestor(registry: PostgresSessionRegistry) {
  return createSessionManager({
    config,
    globalEventBus: createEventBus(),
    contactStore,
    labelStore,
    logger,
    registry,
  });
}

describe('el registro de sesiones no contesta', () => {
  it('create() se rinde con un error propio en lugar de esperar para siempre', async () => {
    const sm = gestor(registroQueNoContesta());
    await sm.bootstrap();

    const inicio = Date.now();
    let capturado: unknown;
    try {
      await sm.create({ accountId: '7', userId: '13' });
    } catch (err) {
      capturado = err;
    }

    expect(capturado).toBeInstanceOf(SessionRegistryUnavailableError);
    expect((capturado as SessionRegistryUnavailableError).operacion).toBe('registry.ensureRow');
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  /**
   * El error tiene que salir **antes** de tocar el pool. Si saliera después, quedaría una sesión a
   * medias que `create()` encontraría en el siguiente intento y devolvería tal cual, sin socket y
   * sin QR — que es precisamente el estado del que no se salía sin reiniciar WACore.
   */
  it('no deja media sesión colgando en el pool', async () => {
    const sm = gestor(registroQueNoContesta());
    await sm.bootstrap();

    await sm.create({ accountId: '7', userId: '13' }).catch(() => {});

    expect(sm.list()).toEqual([]);
  });

  it('bootstrap() tampoco se queda esperando: se rinde y el contenedor puede reiniciarse', async () => {
    const sm = gestor(registroQueNoContesta({ list: () => jamas() } as Partial<PostgresSessionRegistry>));

    const inicio = Date.now();
    let capturado: unknown;
    try {
      await sm.bootstrap();
    } catch (err) {
      capturado = err;
    }

    expect(capturado).toBeInstanceOf(SessionRegistryUnavailableError);
    expect((capturado as SessionRegistryUnavailableError).operacion).toBe('registry.list');
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  /**
   * El plazo no puede convertirse en un límite para la base sana: una llamada que contesta a
   * tiempo tiene que pasar sin enterarse de que hay un cronómetro detrás.
   */
  it('una base que sí contesta pasa sin tocar nada', async () => {
    let creada = false;
    const sm = gestor(registroQueNoContesta({
      ensureRow: async () => { creada = true; },
    } as Partial<PostgresSessionRegistry>));

    await sm.bootstrap();
    // `create()` seguiría hasta arrancar Baileys, que aquí no toca; basta con ver que el registro
    // se atendió y que no saltó el plazo.
    await sm.create({ accountId: '7', userId: '13' }).catch(() => {});

    expect(creada).toBe(true);
  });
});
