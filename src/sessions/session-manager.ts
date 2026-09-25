import { createEventBus } from '../core/event-bus';
import { createAuthProvider } from '../baileys/auth';
import { createBaileysClient, type BaileysClient } from '../baileys/client';
import { createScopedSessionStore } from '../storage/session-store';
import { createMessageSender, type MessageSender } from '../services/message-sender';
import { createRawMessageCache, type RawMessageCache } from '../services/raw-message-cache';
import { createCatalogManager, type CatalogManager } from '../services/catalog-manager';
import { createMessageResolver } from '../services/message-resolver';
import { createSentRegistry, type SentRegistry } from '../services/sent-registry';
import { createPresenceManager, type PresenceManager } from '../services/presence-manager';
import { createReadReceiptManager, type ReadReceiptManager } from '../services/read-receipt-manager';
import { createGroupManager, type GroupManager } from '../services/group-manager';
import { createProfileManager, type ProfileManager } from '../services/profile-manager';
import { createLabelManager, type LabelManager } from '../services/label-manager';
import { createLastMessageTracker, type LastMessageTracker } from '../services/last-message-tracker';
import { createChatManager, type ChatManager } from '../services/chat-manager';
import type { EventBus } from '../core/event-bus';
import type { EnvConfig } from '../types';
import type { Logger } from '../utils/logger';
import type { ContactStore } from '../storage/contact-store';
import type { LabelStore } from '../storage/label-store';
import type { CreateSessionOpts, ListSessionOpts, SessionInfo, SessionStatus } from './types';
import { SessionNotFoundError, SessionRegistryUnavailableError } from './types';
import type { PostgresSessionRegistry } from '../storage/postgres-store';

export interface ManagedSession {
  readonly sessionId: string;
  readonly accountId: string | null;
  readonly userId: string | null;
  readonly client: BaileysClient;
  readonly messageSender: MessageSender;
  readonly presenceManager: PresenceManager;
  readonly readReceiptManager: ReadReceiptManager;
  readonly groupManager: GroupManager;
  readonly profileManager: ProfileManager;
  readonly labelManager: LabelManager;
  readonly chatManager: ChatManager;
  readonly catalogManager: CatalogManager;
  readonly localEventBus: EventBus;
  readonly rawMessageCache?: RawMessageCache;
  readonly sentRegistry?: SentRegistry;
  start(): Promise<void>;
  stop(): Promise<void>;
  logout(): Promise<void>;
  getInfo(): SessionInfo;
}

export interface SessionManager {
  bootstrap(): Promise<void>;
  get(sessionId: string): ManagedSession;
  getOrLegacy(sessionId?: string): ManagedSession;
  create(opts: CreateSessionOpts): Promise<ManagedSession>;
  destroy(sessionId: string): Promise<void>;
  list(opts?: ListSessionOpts): SessionInfo[];
  stopAll(): Promise<void>;
}

interface SessionManagerDeps {
  config: EnvConfig;
  globalEventBus: EventBus;
  contactStore: ContactStore;
  labelStore: LabelStore;
  logger: Logger;
  /**
   * Registro ya construido. En producción no lo pasa nadie: lo abre `initRegistry()` sobre la
   * conexión compartida.
   *
   * Existe para poder probar los plazos, y eso no es un capricho de test: lo que hay que
   * demostrar es qué pasa **cuando la base no contesta nunca**, y eso no se puede provocar con
   * un Postgres de verdad.
   */
  registry?: PostgresSessionRegistry;
}

export function createSessionManager(deps: SessionManagerDeps): SessionManager {
  const { config, globalEventBus, contactStore, labelStore, logger } = deps;
  const pool = new Map<string, ManagedSession>();
  const plazoRegistro = config.registryTimeoutMs ?? 5_000;

  /**
   * Espera al registro, pero no para siempre.
   *
   * **Este plazo es el arreglo, no una precaución.** `create()` espera a que la fila exista
   * *antes* de construir la sesión y arrancar Baileys: mientras esa promesa no vuelva no hay
   * socket, no se emite el evento `qr` y la respuesta HTTP tampoco sale. Una conexión de Postgres
   * atascada dejó así, durante media hora, a **todas** las líneas sin poder emparejarse.
   *
   * Los plazos que lleva puesto el propio Postgres no cubren este caso: el atasco real era el
   * servidor esperando a que el cliente terminase de hablar, y ahí no salta ninguno. El único
   * plazo que sirve es el de este lado.
   *
   * La promesa original sigue su curso; si acaba fallando, la carrera ya la está escuchando y no
   * deja un rechazo suelto.
   */
  function conPlazo<T>(operacion: string, promesa: Promise<T>, ms = plazoRegistro): Promise<T> {
    if (ms <= 0) return promesa;

    let temporizador: ReturnType<typeof setTimeout> | undefined;

    const seAgota = new Promise<never>((_, reject) => {
      temporizador = setTimeout(() => reject(new SessionRegistryUnavailableError(operacion, ms)), ms);
    });

    return Promise.race([promesa, seAgota]).finally(() => {
      // Sin esto queda un temporizador vivo por cada llamada que sí contestó.
      if (temporizador) clearTimeout(temporizador);
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sharedSql: any;
  let registry: PostgresSessionRegistry | null = null;

  async function initRegistry(): Promise<void> {
    if (deps.registry) {
      registry = deps.registry;
      return;
    }
    if (config.sessionStore !== 'postgres' || !config.databaseUrl) return;
    const { createConnection } = await import('../storage/postgres-db');
    const { PostgresSessionRegistry } = await import('../storage/postgres-store');
    const conn = createConnection(config.databaseUrl);
    sharedSql = conn.sql;
    registry = new PostgresSessionRegistry(sharedSql);
  }

  async function buildSession(
    sessionId: string,
    accountId: string | null,
    userId: string | null,
  ): Promise<ManagedSession> {
    const localEventBus = createEventBus();
    const sessionStore = await createScopedSessionStore(config, sessionId, logger, sharedSql);
    const authProvider = await createAuthProvider(sessionStore, logger);
    // La caché se crea **antes** que el cliente porque el cliente la necesita: es de donde
    // Baileys saca el original cuando un teléfono pide que le reenvíen un mensaje que no pudo
    // descifrar, y el mensaje de la invitación cuando llega una confirmación de asistencia.
    const rawMessageCache = createRawMessageCache({
      ttlMs: config.forwardCacheTtlMs ?? 86_400_000,
      max: config.forwardCacheMax ?? 5_000,
    });

    const client = await createBaileysClient(
      config,
      localEventBus,
      authProvider,
      sessionStore,
      logger,
      contactStore,
      labelStore,
      sessionId,
      createMessageResolver(rawMessageCache),
    );
    localEventBus.on('message', (raw: unknown) => {
      const r = raw as { key?: { id?: string | null; remoteJid?: string | null } };
      if (r?.key?.id && r?.key?.remoteJid) rawMessageCache.put(r);
    });

    // Archivar, marcar leído y borrar son parches de app-state que exigen el último mensaje
    // del chat, y WACore no tiene almacén de conversaciones. Se apunta aquí, del mismo evento
    // que alimenta la caché de reenvío, sin tocar el cliente.
    const lastMessages = createLastMessageTracker({ max: 5_000 });
    localEventBus.on('message', (raw: unknown) => {
      const r = raw as {
        key?: { id?: string | null; remoteJid?: string | null; fromMe?: boolean | null };
        messageTimestamp?: number | { toNumber?: () => number } | null;
      };
      const jid = r?.key?.remoteJid;
      const id = r?.key?.id;
      if (!jid || !id) return;
      const bruto = r.messageTimestamp;
      const ts = typeof bruto === 'number'
        ? bruto
        : (typeof bruto?.toNumber === 'function' ? bruto.toNumber() : 0);
      lastMessages.remember(jid, {
        key: { remoteJid: jid, id, fromMe: r.key?.fromMe === true },
        messageTimestamp: ts,
      });
    });

    // Por sesión, no global: dos líneas distintas pueden repetir el id de protocolo, y un
    // registro compartido haría pasar por nuestro el eco del móvil de la otra.
    const sentRegistry = createSentRegistry({
      ttlMs: config.sentRegistryTtlMs ?? 3_600_000,
      max: config.sentRegistryMax ?? 10_000,
    });

    const msgSender = createMessageSender(client, localEventBus, logger, rawMessageCache, sentRegistry);
    const presenceMgr = createPresenceManager(client, config, logger);
    const readReceiptMgr = createReadReceiptManager(client, localEventBus, config, logger);
    const groupMgr = createGroupManager(client, logger);
    const profileMgr = createProfileManager(client, logger);
    const labelMgr = createLabelManager(client, logger);
    const chatMgr = createChatManager(client, lastMessages, logger);
    const catalogMgr = createCatalogManager(client, logger);

    readReceiptMgr.start();
    bridgeEvents(sessionId, accountId, userId, localEventBus, globalEventBus, registry, logger, sentRegistry);

    let currentStatus: SessionStatus = 'disconnected';
    let currentPhoneNumber: string | null = null;
    let everConnected = false;
    let reconnections = 0;

    localEventBus.on('qr', () => {
      currentStatus = 'awaiting-qr';
    });

    // Single listener: keeps in-memory state in sync and updates registry when connected
    localEventBus.on('connection.update', (data) => {
      currentStatus = mapStatus(data.status);
      if (data.status === 'connected') {
        if (everConnected) reconnections++;
        everConnected = true;
      }
      if (data.status === 'connected' && data.phoneNumber) {
        currentPhoneNumber = data.phoneNumber;
        if (registry) {
          registry.updateStatus(sessionId, {
            status: 'connected',
            phoneNumber: data.phoneNumber,
            lastSeenAt: new Date(),
          }).catch(() => {});
        }
      }
    });

    const session: ManagedSession = {
      sessionId,
      accountId,
      userId,
      client,
      messageSender: msgSender,
      presenceManager: presenceMgr,
      readReceiptManager: readReceiptMgr,
      groupManager: groupMgr,
      profileManager: profileMgr,
      labelManager: labelMgr,
      chatManager: chatMgr,
      catalogManager: catalogMgr,
      localEventBus,
      rawMessageCache,
      sentRegistry,

      async start() {
        logger.info('Starting session', { sessionId });
        await client.start();
      },

      async stop() {
        presenceMgr.stop();
        readReceiptMgr.stop();
        await client.stop();
      },

      async logout() {
        await client.logout();
        if (registry) {
          await registry.updateStatus(sessionId, { status: 'logged-out' }).catch(() => {});
        }
      },

      getInfo(): SessionInfo {
        return {
          sessionId,
          accountId,
          userId,
          status: currentStatus,
          phoneNumber: currentPhoneNumber,
          displayName: null,
          lastSeenAt: null,
          reconnections,
        };
      },
    };

    return session;
  }

  return {
    async bootstrap() {
      await initRegistry();

      if (registry) {
        // Con plazo también aquí: sin él, una base colgada dejaba a WACore arrancado pero sin una
        // sola sesión y sin decir por qué. Rendirse hace que el contenedor se reinicie, que es
        // exactamente lo que hay que hacer, en vez de quedarse mudo para siempre.
        const rows = await conPlazo('registry.list', registry.list());

        if (rows.length === 0) {
          // Registro vacío. En modo multi-tenant eso significa «no hay ninguna línea», no
          // «arranca una sin dueño»: crearla emparejaba una sesión con account_id y user_id
          // nulos, que pinta un QR indefinidamente y deja una fila que se vuelve a arrancar en
          // cada reinicio. Los eventos de esa sesión llegan sin identidad, así que quien la
          // escanee no aparece en ninguna cuenta.
          if (!config.legacySessionEnabled) {
            logger.info('No sessions registered; skipping the ownerless legacy session');
            return;
          }

          const legacyId = config.instanceName;
          await conPlazo('registry.ensureRow', registry.ensureRow(legacyId, null, null));
          const session = await buildSession(legacyId, null, null);
          pool.set(legacyId, session);
          if (config.connectOnStartup) await session.start();
          logger.info('Bootstrapped legacy session', { sessionId: legacyId });
          return;
        }

        const starts: Promise<void>[] = [];
        for (const row of rows) {
          if (pool.size >= (config.maxSessions ?? 50)) {
            logger.warn('Max sessions reached during bootstrap, skipping', { sessionId: row.instanceName });
            continue;
          }
          try {
            const session = await buildSession(row.instanceName, row.accountId, row.userId);
            pool.set(row.instanceName, session);
            if (config.connectOnStartup) {
              starts.push(
                session.start().catch(err =>
                  logger.error('Failed to start session on bootstrap', { sessionId: row.instanceName, error: String(err) })
                )
              );
            }
          } catch (err) {
            logger.error('Failed to build session on bootstrap', { sessionId: row.instanceName, error: String(err) });
          }
        }
        await Promise.all(starts);
        logger.info('Bootstrap complete', { sessions: pool.size });
      } else {
        // Non-postgres: single legacy session
        const legacyId = config.instanceName;
        const session = await buildSession(legacyId, null, null);
        pool.set(legacyId, session);
        if (config.connectOnStartup) await session.start();
        logger.info('Bootstrapped single session', { sessionId: legacyId });
      }
    },

    get(sessionId: string): ManagedSession {
      const session = pool.get(sessionId);
      if (!session) throw new SessionNotFoundError(sessionId);
      return session;
    },

    getOrLegacy(sessionId?: string): ManagedSession {
      // When sessionId is explicitly provided, never silently cross to another tenant's session.
      if (sessionId !== undefined) {
        const session = pool.get(sessionId);
        if (!session) throw new SessionNotFoundError(sessionId);
        return session;
      }
      // No sessionId given → pure legacy fallback: use instanceName, then first available.
      const legacySession = pool.get(config.instanceName);
      if (legacySession) return legacySession;
      const first = pool.values().next().value;
      if (first) return first;
      throw new SessionNotFoundError(config.instanceName);
    },

    async create(opts: CreateSessionOpts): Promise<ManagedSession> {
      const sessionId = `${opts.accountId}:${opts.userId}`;

      const existente = pool.get(sessionId);

      /**
       * Una sesión en el pool **sin dueño** es una línea rota, no una línea sana.
       *
       * Pasa al reiniciar: `bootstrap()` reconstruye las sesiones leyendo el registro, y si esa
       * fila perdió su `account_id` la sesión nace anónima. A partir de ahí todas las llamadas
       * del consumidor se van en 403 y no hay forma de salir: `create()` la encontraba en el pool y la
       * devolvía tal cual, sin llegar a `ensureRow`, así que el dueño no se rellenaba nunca.
       *
       * Aquí se rehace con su dueño. Cortar la conexión no cuesta nada en este estado —está
       * rebotando todas las peticiones—, y es lo único que la devuelve a la vida sin reiniciar
       * WACore entero.
       */
      if (existente && opts.accountId && !existente.accountId) {
        logger.warn('Session in the pool had no owner; rebuilding it', { sessionId });
        await existente.stop().catch(() => {});
        pool.delete(sessionId);

        if (registry) {
          await conPlazo('registry.ensureRow', registry.ensureRow(sessionId, opts.accountId, opts.userId));
        }

        const rehecha = await buildSession(sessionId, opts.accountId, opts.userId);
        pool.set(sessionId, rehecha);
        await rehecha.start();
        return rehecha;
      }

      if (existente) {
        // Una sesión que cerró sesión o se cayó **sigue en el pool**: `logout()` apaga el
        // cliente pero no la desaloja. Devolverla tal cual dejaba la conexión muerta para
        // siempre — nadie la arrancaba, así que no se generaba QR nuevo y la pantalla de
        // Conexiones abría el modal y lo cerraba sin nada que enseñar. La única salida era
        // reiniciar WACore entero.
        const estado = existente.getInfo().status;
        if (estado === 'disconnected' || estado === 'logged-out') {
          logger.info('Restarting a session that was down', { sessionId, previousStatus: estado });
          await existente.start();
        }
        return existente;
      }
      if (pool.size >= (config.maxSessions ?? 50)) {
        throw new Error(`Max sessions (${(config.maxSessions ?? 50)}) reached`);
      }

      if (registry) {
        // El plazo va aquí y no más abajo porque este `await` es el que estaba bloqueando el QR:
        // si no vuelve, no se construye la sesión, no arranca Baileys y no hay código que enseñar.
        // Al agotarse sale un error antes de tocar el pool, así que no queda media sesión colgando.
        await conPlazo('registry.ensureRow', registry.ensureRow(sessionId, opts.accountId, opts.userId));
      }

      const session = await buildSession(sessionId, opts.accountId, opts.userId);
      pool.set(sessionId, session);
      await session.start();
      return session;
    },

    async destroy(sessionId: string): Promise<void> {
      const session = pool.get(sessionId);
      if (!session) throw new SessionNotFoundError(sessionId);
      try { await session.logout(); } catch { /* already disconnected */ }
      await session.stop().catch(() => {});
      pool.delete(sessionId);
      if (registry) {
        // Con plazo y sin exigirlo: la sesión ya está fuera del pool y cerrada. Que la fila tarde
        // en borrarse no es motivo para dejar colgada la petición de quien la eliminó.
        await conPlazo('registry.deleteRow', registry.deleteRow(sessionId)).catch(() => {});
      }
    },

    list(opts?: ListSessionOpts): SessionInfo[] {
      const sessions = Array.from(pool.values());
      if (opts?.accountId) {
        return sessions
          .filter(s => s.accountId === opts.accountId)
          .map(s => s.getInfo());
      }
      return sessions.map(s => s.getInfo());
    },

    async stopAll(): Promise<void> {
      const results = await Promise.allSettled(Array.from(pool.values()).map(s => s.stop()));
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error('Failed to stop session during shutdown', { error: String(result.reason) });
        }
      }
      pool.clear();
    },
  };
}

function bridgeEvents(
  sessionId: string,
  accountId: string | null,
  userId: string | null,
  localBus: EventBus,
  globalBus: EventBus,
  registry: PostgresSessionRegistry | null,
  _logger: Logger,
  sentRegistry?: SentRegistry,
): void {
  localBus.on('message', (raw: any) => {
    // El origen se sella aquí, que es el único punto donde se sabe de qué sesión viene el
    // mensaje: el registro de enviados es por sesión y el bus global ya no lo distingue.
    const key = raw?.key ?? {};
    const origin = key.fromMe
      ? (sentRegistry?.has(key.remoteJid ?? '', key.id ?? '') ? 'api' : 'device')
      : undefined;

    globalBus.emit('message', Object.assign({}, raw, {
      _sessionId: sessionId,
      _accountId: accountId,
      _userId: userId,
      ...(origin ? { _origin: origin } : {}),
    }));
  });

  // El histórico va por su propio evento y **no** lleva sello de origen: al emparejar, el
  // registro de enviados está vacío y todo saldría como escrito a mano. Es lo correcto: en un
  // volcado de histórico el consumidor no tiene nada guardado, así que todo tiene que entrar, lo
  // escribiera el cliente o nosotros.
  localBus.on('history.message', (raw: any) => {
    globalBus.emit('history.message', Object.assign({}, raw, {
      _sessionId: sessionId,
      _accountId: accountId,
      _userId: userId,
    }));
  });

  localBus.on('history.synced', (data: any) => {
    globalBus.emit('history.synced', {
      ...data,
      sessionId,
      accountId,
      userId,
    });
  });

  localBus.on('connection.update', (data) => {
    const enriched = { ...data, sessionId, accountId, userId };
    globalBus.emit('connection.update', enriched);
    if (registry) {
      const status = mapStatus(data.status);
      registry.updateStatus(sessionId, {
        status,
        phoneNumber: data.phoneNumber,
        lastSeenAt: new Date(),
      }).catch(() => {});
    }
  });

  localBus.on('qr', (data) => {
    globalBus.emit('qr', { ...data, sessionId, accountId, userId });
  });

  localBus.on('media.downloaded', (data) => {
    globalBus.emit('media.downloaded', { ...data, sessionId, accountId, userId });
  });

  localBus.on('auth.logged-out', (data) => {
    globalBus.emit('auth.logged-out', data);
    if (registry) {
      registry.updateStatus(sessionId, { status: 'logged-out' }).catch(() => {});
    }
  });

  localBus.on('creds.update', (data) => {
    globalBus.emit('creds.update', data);
  });

  localBus.on('auth.state-change', (data) => {
    globalBus.emit('auth.state-change', data);
  });

  localBus.on('error', (data) => {
    globalBus.emit('error', data);
  });

  localBus.on('call', (data) => {
    globalBus.emit('call', { ...data, sessionId, accountId, userId });
  });

  localBus.on('presence.contact', (data) => {
    globalBus.emit('presence.contact', { ...data, sessionId, accountId, userId });
  });

  localBus.on('message.status', (data) => {
    globalBus.emit('message.status', { ...data, sessionId, accountId, userId });
  });
}

function mapStatus(status: string): SessionStatus {
  switch (status) {
    case 'connected': return 'connected';
    case 'connecting': return 'starting';
    case 'disconnected': return 'disconnected';
    default: return 'disconnected';
  }
}
