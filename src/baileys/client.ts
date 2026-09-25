import {
  makeWASocket,
  fetchLatestBaileysVersion,
  DisconnectReason,
  useMultiFileAuthState,
  isLidUser,
  jidNormalizedUser,
  type WASocket,
  type UserFacingSocketConfig,
} from 'baileys';
import type { Logger } from '../utils/logger';
import type { EventBus } from '../core/event-bus';
import type { AuthProvider } from './auth';
import type { SessionStore } from '../storage/session-store';
import type { ContactStore } from '../storage/contact-store';
import { InMemoryContactStore, digitsOfJid } from '../storage/contact-store';
import type { LabelStore } from '../storage/label-store';
import { InMemoryLabelStore } from '../storage/label-store';
import type { UpsertContact } from '../types/contact';
import type { EnvConfig, ConnectionStatus, PresenceType, MessageStatusCode, MessageStatusLabel } from '../types';
import type { Contact } from '../types/contact';
import { createReconnectionManager } from '../core/reconnection';

/**
 * Devuelve el contenido de un mensaje que esta línea envió, si todavía se recuerda.
 *
 * Baileys lo llama en dos momentos, y **sin él los dos fallan en silencio**:
 *
 * 1. Cuando el teléfono del destinatario no consigue descifrar un mensaje y pide que se lo
 *    reenvíen. Sin el original no hay nada que reenviar: el consumidor da el mensaje por enviado y al
 *    cliente no le llega nunca.
 * 2. Cuando llega la respuesta a una invitación de calendario o el voto de una encuesta. Vienen
 *    **cifradas** con el `messageSecret` del mensaje original, así que sin él Baileys solo puede
 *    escribir «event creation message not found» y tirar la respuesta.
 *
 * El valor por defecto de Baileys es `async () => undefined`, que es justo lo que hacía WACore
 * al no pasar nada.
 */
export type ResolveMessage = (key: {
  remoteJid?: string | null;
  id?: string | null;
  fromMe?: boolean | null;
  participant?: string | null;
}) => Promise<unknown | undefined>;

export interface BaileysClient {
  socket: WASocket | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  connect(): Promise<void>;
  sendMessage(jid: string, content: any, options?: any): Promise<any>;
  sendPresenceUpdate(jid: string, type: PresenceType): Promise<void>;
  presenceSubscribe(jid: string): Promise<void>;
  readMessages(keys: Array<{
    remoteJid: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  }>): Promise<void>;
  getConnectionStatus(): ConnectionStatus;
  getQr(): string | null;
  logout(): Promise<void>;
  getContacts(): Contact[];
  /**
   * Vuelve a pedir a WhatsApp la agenda entera de la línea y espera a tenerla guardada.
   *
   * Es lo que permite importar la agenda de una línea que ya estaba conectada, o que se conectó
   * hace unos segundos y todavía no la ha recibido entera.
   */
  resyncContacts(): Promise<ResyncContactsResult>;
  uploadPreKeysToServerIfRequired(): Promise<void>;
}

export interface ResyncContactsResult {
  total: number;
  inAddressBook: number;
  /**
   * Si WhatsApp llegó a entregar la agenda.
   *
   * `false` cuando la colección no se pudo sincronizar: Baileys lo reintenta y **se rinde sin
   * lanzar**, así que sin esto un fallo de lectura se contaba como «esta línea no tiene
   * contactos», que es indistinguible de una agenda vacía y manda al consumidor a decir «0 importados».
   */
  addressBookSynced: boolean;
  /** Registros del snapshot que no se pudieron leer y se saltaron. */
  skippedRecords: number;
}

/** La colección de app-state donde viajan los contactos de la agenda (`contactAction`). */
const COLECCION_AGENDA = 'critical_unblock_low' as const;

/** Lo más que se espera a que se guarde la agenda tras un resync antes de contestar. */
const TOPE_ESPERA_AGENDA_MS = 30_000;

const esperar = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function esLid(jid: unknown): jid is string {
  return typeof jid === 'string' && (jid.endsWith('@lid') || jid.endsWith('@hosted.lid'));
}

function esTelefono(jid: unknown): jid is string {
  return typeof jid === 'string'
    && (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us') || jid.endsWith('@hosted'));
}

/** El JID de teléfono canónico, sin dispositivo: `34600:12@s.whatsapp.net` → `34600@s.whatsapp.net`. */
function jidDeTelefono(jid: string): string {
  return `${digitsOfJid(jid)}@s.whatsapp.net`;
}


/**
 * Cuánto tiene que aguantar una conexión para considerar que de verdad se ganó la sesión.
 *
 * En una guerra de reemplazos las conexiones duran milisegundos: sin este umbral, cada una
 * reiniciaría el contador y la pelea no terminaría nunca.
 */
const CONEXION_ESTABLE_MS = 30_000;

/** Reemplazos seguidos tras los que se deja de pelear por la sesión. */
const MAX_REEMPLAZOS = 3;

export async function createBaileysClient(
  config: EnvConfig,
  eventBus: EventBus,
  authProvider: AuthProvider,
  sessionStore: SessionStore,
  logger: Logger,
  contactStore: ContactStore = new InMemoryContactStore(),
  labelStore: LabelStore = new InMemoryLabelStore(),
  sessionId: string = config.instanceName,
  resolveMessage?: ResolveMessage,
): Promise<BaileysClient> {
  let socket: WASocket | null = null;
  let connectionStatus: ConnectionStatus = 'disconnected';
  let currentQr: string | null = null;

  /**
   * Versión de WhatsApp Web que se anuncia al conectar.
   *
   * Baileys trae una fija en su propio paquete, y WhatsApp **rechaza las versiones
   * caducadas**: el socket se abre y se cierra al instante con connectionReplaced (405),
   * sin llegar a emitir el QR, así que la sesión nunca se puede vincular. Con la librería
   * publicada hace meses eso pasa sin más aviso que ese bucle.
   *
   * Se resuelve la última al arrancar. Si no se puede consultar, se deja que Baileys use la
   * suya: mejor intentarlo que no arrancar.
   */
  let waVersion: [number, number, number] | undefined;

  // ─── Volcado de histórico ──────────────────────────────────────────────────
  //
  // Al vincular una línea, WhatsApp entrega meses de conversaciones en varias tandas. Hasta
  // ahora se descartaban enteras y la bandeja del consumidor nacía vacía.
  //
  // Tres decisiones de volumen, que son el fondo del asunto:
  //
  // 1. **No salen por el evento `message`.** Ese evento alimenta al descargador de adjuntos —que
  //    se pondría a bajar miles de archivos—, a los consumidores y a la caché global. Van por
  //    `history.message`, que solo escucha el publicador.
  // 2. **Goteo, no ráfaga.** Diez mil de golpe revientan el canal AMQP y las colas del consumidor.
  // 3. **Tope.** Una cuenta con años de conversaciones no puede tumbar el arranque de la sesión.
  const historyEnabled = config.historySyncEnabled !== false;
  const historyMax = config.historyMax ?? 5000;
  const historyBatchSize = Math.max(1, config.historyBatchSize ?? 200);
  const historyBatchDelayMs = Math.max(0, config.historyBatchDelayMs ?? 250);

  const historyQueue: unknown[] = [];
  let historyDraining = false;
  let historyEmitted = 0;
  let historySkipped = 0;
  let historyIdleTimer: ReturnType<typeof setTimeout> | null = null;

  function queueHistory(messages: unknown): void {
    if (!historyEnabled) return;
    if (!Array.isArray(messages) || messages.length === 0) return;

    const hueco = historyMax - historyEmitted - historyQueue.length;

    if (hueco <= 0) {
      historySkipped += messages.length;
      logger.warn('History sync cap reached, skipping the rest', {
        sessionId, historyMax, skipped: historySkipped,
      });
      return;
    }

    if (messages.length > hueco) {
      historySkipped += messages.length - hueco;
      logger.warn('History sync cap reached, truncating batch', {
        sessionId, historyMax, skipped: historySkipped,
      });
    }

    historyQueue.push(...messages.slice(0, hueco));
    void drainHistory();
  }

  async function drainHistory(): Promise<void> {
    if (historyDraining) return;
    historyDraining = true;

    try {
      while (historyQueue.length > 0) {
        const lote = historyQueue.splice(0, historyBatchSize);

        for (const m of lote) {
          const raw = m as { key?: { id?: string; remoteJid?: string } };
          // Sin clave no hay identidad, y sin identidad el consumidor no puede evitar duplicarlo.
          if (!raw?.key?.id || !raw?.key?.remoteJid) continue;
          eventBus.emit('history.message', m);
          historyEmitted++;
        }

        if (historyQueue.length > 0) {
          await new Promise(r => setTimeout(r, historyBatchDelayMs));
        }
      }

      // WhatsApp manda el histórico en varias tandas y entre una y otra el goteo se vacía. Un
      // aviso de «ya está» por tanda sería mentira, así que se espera a que deje de llegar.
      if (historyIdleTimer) clearTimeout(historyIdleTimer);
      historyIdleTimer = setTimeout(() => {
        logger.info('History sync finished', { sessionId, count: historyEmitted, skipped: historySkipped });
        eventBus.emit('history.synced', {
          sessionId,
          count: historyEmitted,
          skipped: historySkipped,
        });
      }, Math.max(250, historyBatchDelayMs * 8));
      historyIdleTimer.unref?.();
    } catch (err) {
      logger.error('History sync drain failed', { sessionId, error: String(err) });
    } finally {
      historyDraining = false;
    }
  }

  async function resolveWaVersion(): Promise<void> {
    const pinned = process.env.WA_WEB_VERSION?.trim();

    // Fijarla a mano es la salida de emergencia si la que anuncia WhatsApp deja de valer.
    if (pinned) {
      const parts = pinned.split('.').map((n) => Number.parseInt(n, 10));

      if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
        waVersion = parts as [number, number, number];
        logger.info('Using pinned WhatsApp Web version', { version: waVersion.join('.') });
        return;
      }

      logger.warn('WA_WEB_VERSION is not a valid x.y.z version, ignoring', { value: pinned });
    }

    try {
      const { version, isLatest } = await fetchLatestBaileysVersion();
      waVersion = version as [number, number, number];
      logger.info('Resolved WhatsApp Web version', { version: waVersion.join('.'), isLatest });
    } catch (err) {
      logger.warn('Could not resolve the WhatsApp Web version, using the bundled one', {
        error: String(err),
      });
    }
  }
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let preKeyTimer: ReturnType<typeof setInterval> | null = null;
  let isStopping = false;
  const contacts = new Map<string, Contact>();

  // ─── Agenda ────────────────────────────────────────────────────────────────
  //
  // Tres reglas que la versión anterior tenía mal, y por las que la agenda que se importaba al
  // consumidor no era la del teléfono:
  //
  // 1. **Es de esta línea.** Todo se guarda con el `sessionId`.
  // 2. **El teléfono es el teléfono.** Baileys 7 identifica a la mayoría de contactos por su LID,
  //    y guardar sus dígitos como número dejaba teléfonos a los que no se puede escribir. Se busca
  //    el número real —el `phoneNumber` del propio evento o el mapeo LID→PN— y, si no lo hay, se
  //    deja vacío.
  // 3. **«Guardado» es tener nombre de agenda.** En Baileys `name` es como tú lo tienes guardado y
  //    `notify` como se llama él. Aquí estaba al revés, y además cada mensaje entrante desmarcaba
  //    al contacto al reescribir su fila.

  /** Guardados de agenda que siguen en vuelo: el resync espera a que acaben antes de contestar. */
  const escriturasDeAgenda = new Set<Promise<void>>();
  /** El último pushName apuntado de cada remitente, para no escribir en la base con cada mensaje. */
  const pushNamesVistos = new Map<string, string | null>();
  let resyncEnCurso: Promise<ResyncContactsResult> | null = null;

  function seguir(tarea: Promise<void>, origen: string): void {
    const seguida: Promise<void> = tarea
      .catch(err => logger.warn(`${origen}: no se pudo guardar la agenda`, { error: String(err) }))
      .finally(() => { escriturasDeAgenda.delete(seguida); });
    escriturasDeAgenda.add(seguida);
  }

  async function telefonoDeLid(sock: WASocket, lid: string): Promise<string | null> {
    try {
      const pn = await (sock as any).signalRepository?.lidMapping?.getPNForLID(lid);
      return esTelefono(pn) ? jidDeTelefono(pn) : null;
    } catch (err) {
      logger.debug('No se pudo traducir un LID a teléfono', { lid, error: String(err) });
      return null;
    }
  }

  /** Un contacto de Baileys, traducido a lo que se guarda. `null` si no es un contacto. */
  async function filaDeContacto(sock: WASocket, c: any): Promise<UpsertContact | null> {
    const id = texto(c?.id);
    if (!id || id.includes('@broadcast')) return null;

    const esGrupo = id.endsWith('@g.us');
    const esPersona = !esGrupo && !id.endsWith('@newsletter');

    const lid = esLid(id) ? id : (esLid(c.lid) ? c.lid : null);
    let pn = esTelefono(id) ? jidDeTelefono(id) : (esTelefono(c.phoneNumber) ? jidDeTelefono(c.phoneNumber) : null);
    if (!pn && lid) pn = await telefonoDeLid(sock, lid);

    const nombreDeAgenda = texto(c.name);
    const foto = texto(c.imgUrl);

    return {
      jid: pn ?? id,
      phone: pn ? digitsOfJid(pn) : null,
      lid,
      bookName: nombreDeAgenda,
      pushName: texto(c.notify),
      verifiedName: texto(c.verifiedName),
      // `imgUrl` vale 'changed' cuando la foto cambió y todavía no se ha pedido: no es una URL.
      profilePicUrl: foto && /^https?:\/\//i.test(foto) ? foto : null,
      isBusiness: !!(c.isBusiness || texto(c.verifiedName)),
      // Baileys rellena `name` con el nombre de usuario cuando no hay otro: ese no es de agenda.
      inAddressBook: esPersona && nombreDeAgenda !== null && nombreDeAgenda !== texto(c.username),
      isGroup: esGrupo,
    };
  }

  function recordarContacto(f: UpsertContact): void {
    const previo = contacts.get(f.jid);
    contacts.set(f.jid, {
      jid: f.jid,
      phone: f.phone ?? previo?.phone ?? '',
      name: f.bookName ?? previo?.name ?? f.verifiedName ?? f.pushName ?? f.phone ?? digitsOfJid(f.jid),
    });
  }

  function registrarContactos(sock: WASocket, lista: unknown, origen: string): void {
    if (!Array.isArray(lista) || lista.length === 0) return;

    seguir((async () => {
      const filas: UpsertContact[] = [];
      for (const c of lista) {
        const fila = await filaDeContacto(sock, c);
        if (fila) filas.push(fila);
      }
      if (filas.length === 0) return;

      filas.forEach(recordarContacto);
      await contactStore.upsertMany(sessionId, filas);
    })(), origen);
  }

  /**
   * Quien escribe entra en la agenda de la línea como conocido, nunca como guardado: solo se
   * apunta su pushName, y solo la primera vez o cuando cambia.
   *
   * @param remoteJid el JID tal como llegó, que puede ser el LID
   * @param jid       el mismo, ya traducido a teléfono si se pudo
   */
  function anotarRemitente(remoteJid: string | null | undefined, jid: string, pushName: unknown): void {
    const nombre = texto(pushName);
    if (pushNamesVistos.has(jid) && (nombre === null || pushNamesVistos.get(jid) === nombre)) return;
    pushNamesVistos.set(jid, nombre);

    const fila: UpsertContact = {
      jid: esTelefono(jid) ? jidDeTelefono(jid) : jid,
      phone: esTelefono(jid) ? digitsOfJid(jid) : null,
      lid: esLid(remoteJid) ? remoteJid : (esLid(jid) ? jid : null),
      pushName: nombre,
    };

    recordarContacto(fila);
    seguir(contactStore.upsertMany(sessionId, [fila]), 'mensaje entrante');
  }

  /**
   * Baileys suelta los eventos del resync unos 100 ms después de terminar —los acumula para
   * entregarlos juntos— y cada tanda se guarda en segundo plano. Se espera a las dos cosas, con
   * tope, para contestar con la agenda ya escrita y no con la de antes.
   */
  async function esperarAgendaGuardada(): Promise<void> {
    const limite = Date.now() + TOPE_ESPERA_AGENDA_MS;
    await esperar(300);
    while (escriturasDeAgenda.size > 0 && Date.now() < limite) {
      await Promise.race([Promise.allSettled([...escriturasDeAgenda]), esperar(1_000)]);
    }
  }

  /** Si la colección de la agenda quedó sincronizada, que es lo que deja su versión guardada. */
  async function colecciónSincronizada(sock: WASocket): Promise<boolean> {
    try {
      const guardado = await (sock as any).authState.keys.get('app-state-sync-version', [COLECCION_AGENDA]);

      return Boolean(guardado?.[COLECCION_AGENDA]);
    } catch (err) {
      logger.warn('No se pudo comprobar si la agenda se sincronizó', { error: String(err) });

      return false;
    }
  }

  /** La agenda era de las credenciales que se van: la siguiente puede ser de otro teléfono. */
  function olvidarAgenda(): void {
    contacts.clear();
    pushNamesVistos.clear();
    seguir(contactStore.purgeSession(sessionId), 'cierre de sesión');
  }

  const reconnection = createReconnectionManager(eventBus, logger);

  /**
   * Rondas de QR gastadas sin que nadie escanee. Se pone a cero al conectar.
   *
   * Una sesión sin emparejar reintentaba para siempre: Baileys agota los códigos
   * (`QR refs attempts ended`), cierra con `timedOut`, y como ese motivo sí es reintentable
   * vuelve a empezar. En dev llegó al intento 74, generando 1.767 eventos `qr` que no le
   * importaban a nadie y manteniendo viva una línea que ya nadie iba a escanear.
   */
  let rondasDeQrSinEmparejar = 0;

  /**
   * Veces seguidas que **otro cliente** nos ha echado de la sesión.
   *
   * `connectionReplaced` (440) no es una caída: es que alguien más —otra pestaña de WhatsApp Web,
   * otra herramienta, otro servidor con estas credenciales— ha tomado la sesión. Reconectar es lo
   * peor que se puede hacer: cada lado echa al otro y arranca una guerra de varias reconexiones
   * **por segundo**, que machaca a WhatsApp —motivo habitual de bloqueo de un número— y llena el
   * consumidor de cambios de estado que no significan nada.
   *
   * No sirve el contador de reintentos general: conectar reinicia el contador, y en esta guerra se
   * conecta cada vez. Por eso se cuenta aparte, y solo lo pone a cero una conexión que **aguante**.
   */
  let vecesReemplazada = 0;
  let conectadaDesde: number | null = null;

  /**
   * ¿Tiene esta sesión credenciales de un emparejamiento anterior?
   *
   * Es la línea que separa los dos casos, y no se puede cruzar: una sesión **con** credenciales
   * reintenta siempre —rendirse ahí dejó una línea pidiendo QR por un corte de DNS de tres
   * minutos— y solo una **sin** credenciales puede darse por abandonada.
   */
  function estaEmparejada(): boolean {
    return Boolean((authProvider.state as { creds?: { registered?: boolean; me?: unknown } })?.creds?.registered)
      || Boolean((authProvider.state as { creds?: { me?: unknown } })?.creds?.me);
  }

  /**
   * Tira las credenciales que WhatsApp ya ha invalidado, para que el siguiente arranque pida QR.
   *
   * Un `401 loggedOut` significa que la sesión ya no existe al otro lado. Volver a intentarlo con
   * las mismas credenciales no puede funcionar nunca, y además **impide que se pida un código**:
   * Baileys solo emite el evento `qr` cuando el estado de autenticación viene vacío. Con unas
   * credenciales muertas en memoria, la línea se queda en un bucle de `logging in…` → `401` que
   * `whatsapp:check-sessions` relanza cada cinco minutos, sin QR y sin salida. Hasta ahora la
   * única cura era reiniciar WACore entero.
   *
   * Esto ya lo hacía `connect()`, pero las sesiones se rearrancan por `start()` —es lo que llama
   * `sessionManager.create()` cuando encuentra una línea caída en el pool—, así que por ese camino
   * no se limpiaba nunca. La regla vive en un solo sitio para que no vuelva a haber un camino
   * privilegiado y otro olvidado.
   *
   * Solo actúa al **arrancar a propósito**. En el cierre no se toca nada, ni en memoria ni en la
   * fila persistida: un 401 puntual no debe destruir una sesión buena.
   */
  function descartarCredencialesMuertas(): void {
    if (connectionStatus !== 'logged-out') return;

    logger.info('Resetting auth state for reconnection');
    authProvider.reset();
    olvidarAgenda();
  }

  function updateStatus(status: ConnectionStatus, phone?: string) {
    connectionStatus = status;
    eventBus.emit('connection.update', {
      status: status as any,
      previous: undefined,
      phoneNumber: phone,
    });
  }

  function buildSocket(): WASocket {
    const sock = makeWASocket({
      auth: authProvider.state as any,
      printQRInTerminal: true,
      ...(waVersion ? { version: waVersion } : {}),
      logger: {
        trace: (...args: any[]) => logger.debug(formatBaileysArgs(args), { source: 'baileys' }),
        debug: (...args: any[]) => logger.debug(formatBaileysArgs(args), { source: 'baileys' }),
        info: (...args: any[]) => logger.info(formatBaileysArgs(args), { source: 'baileys' }),
        warn: (...args: any[]) => logger.warn(formatBaileysArgs(args), { source: 'baileys' }),
        error: (...args: any[]) => logger.error(formatBaileysArgs(args), { source: 'baileys' }),
        child: () => {
          const childLogger = {
            trace: (...args: any[]) => logger.debug(formatBaileysArgs(args), { source: 'baileys.child' }),
            debug: (...args: any[]) => logger.debug(formatBaileysArgs(args), { source: 'baileys.child' }),
            info: (...args: any[]) => logger.info(formatBaileysArgs(args), { source: 'baileys.child' }),
            warn: (...args: any[]) => logger.warn(formatBaileysArgs(args), { source: 'baileys.child' }),
            error: (...args: any[]) => logger.error(formatBaileysArgs(args), { source: 'baileys.child' }),
            child: () => childLogger,
          };
          return childLogger;
        },
      } as any,
      syncFullHistory: false,
      fireInitQueries: true,
      ...(resolveMessage
        ? { getMessage: (key: any) => resolveMessage(key) as Promise<any> }
        : {}),
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        currentQr = qr;
        eventBus.emit('qr', { qr, timeout: config.qrTimeout });
        updateStatus('awaiting-qr');
        logger.info('Escanea el QR con WhatsApp para conectar:');
        try {
          const qrcode = await import('qrcode-terminal');
          qrcode.default.generate(qr, { small: true });
        } catch {
          process.stdout.write(qr + '\n');
        }
      }

      if (connection === 'open') {
        currentQr = null;
        const phone = sock.user?.id ? sock.user.id.split(':')[0] : undefined;
        reconnection.reset();
        rondasDeQrSinEmparejar = 0;
        conectadaDesde = Date.now();
        updateStatus('connected', phone);
        sock.uploadPreKeysToServerIfRequired?.().catch(err => logger.warn('Pre-key upload failed on connect', { error: String(err) }));
        logger.info('WhatsApp connected', { phone });
      }

      if (connection === 'close') {
        if (isStopping) return;
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const reason = mapDisconnectReason(statusCode);

        logger.warn('WhatsApp connection closed', {
          reason,
          statusCode,
          willReconnect: reconnection.shouldReconnect(reason),
        });

        if (!reconnection.shouldReconnect(reason)) {
          // NOTE: no borramos las credenciales aquí. Un 401/403/411 transitorio
          // no debe destruir la sesión persistida — el borrado real sólo debe
          // ocurrir por acción explícita del usuario (sessionManager.destroy()).
          socket = null;
          updateStatus('logged-out');
          eventBus.emit('auth.logged-out', {
            reason: String(reason),
            willReconnect: false,
          });
          return;
        }

        // Nos han echado de la sesión. Se dan un par de oportunidades por si fue algo puntual
        // —alguien abrió WhatsApp Web un momento y lo cerró—, y si el otro cliente sigue ahí se
        // deja de pelear: la línea queda caída y la recupera quien decida cerrar la otra sesión.
        // Las credenciales no se tocan, así que reconectar después es inmediato.
        if (reason === 'connectionReplaced') {
          // Solo cuenta como «aguantó» una conexión que duró algo. En la guerra dura milisegundos.
          const aguanto = conectadaDesde !== null && Date.now() - conectadaDesde > CONEXION_ESTABLE_MS;
          vecesReemplazada = aguanto ? 1 : vecesReemplazada + 1;
          conectadaDesde = null;

          if (vecesReemplazada >= MAX_REEMPLAZOS) {
            logger.error('Otro cliente tiene esta sesión de WhatsApp; se deja de reconectar', {
              veces: vecesReemplazada,
            });
            socket = null;
            updateStatus('disconnected');

            return;
          }
        } else {
          vecesReemplazada = 0;
        }

        // Una sesión que nunca llegó a emparejarse no reintenta indefinidamente. Agotadas sus
        // rondas se queda quieta y en `disconnected`, que es lo que hace que el consumidor ofrezca
        // «Nuevo QR» en lugar de enseñar un código muerto. Volver a intentarlo es una decisión
        // de quien la use, no del proceso.
        if (!estaEmparejada()) {
          rondasDeQrSinEmparejar++;

          if (rondasDeQrSinEmparejar >= Math.max(1, config.qrMaxRounds ?? 3)) {
            logger.warn('QR abandonado: nadie lo escaneó, la sesión deja de reintentar', {
              rondas: rondasDeQrSinEmparejar,
            });
            currentQr = null;
            socket = null;
            updateStatus('disconnected');
            return;
          }
        }

        reconnection.recordFailure(reason);
        const delay = reconnection.getDelay(reason);

        // Agotados los intentos rápidos seguimos reintentando, pero el estado deja de ser
        // «arrancando» y pasa a «caída». Es la diferencia entre las dos cosas que hay que
        // conseguir a la vez: recuperarse solo cuando la red vuelva, y que mientras tanto el consumidor
        // pueda avisar a quien la usa. Marcarla `connecting` para siempre la dejaba muda.
        updateStatus(reconnection.isExhausted(reason) ? 'disconnected' : 'connecting');
        socket = null;

        reconnectTimer = setTimeout(async () => {
          logger.info('Reconnecting...', { attempt: reconnection.getAttempt(), delay });
          socket = buildSocket();
        }, delay);
      }
    });

    // La agenda del teléfono (`contactAction`) llega por aquí; durante el emparejamiento Baileys
    // la funde con el volcado y llega por `messaging-history.set`.
    sock.ev.on('contacts.upsert', (upserted: any[]) => {
      registrarContactos(sock, upserted, 'contacts.upsert');
    });

    sock.ev.on('contacts.update', (updates: any[]) => {
      registrarContactos(sock, updates, 'contacts.update');
    });

    // WhatsApp revela más tarde el número de quien conocíamos solo por el LID.
    sock.ev.on('lid-mapping.update', ({ lid, pn }: { lid: string; pn: string }) => {
      if (!esLid(lid) || !esTelefono(pn)) return;
      seguir(contactStore.mergeLid(sessionId, lid, jidDeTelefono(pn)), 'lid-mapping.update');
    });

    sock.ev.on('messaging-history.set', ({ contacts: historicContacts, messages: historicMessages }: any) => {
      // Los mensajes van por su cuenta: son la parte que hasta ahora se tiraba entera.
      queueHistory(historicMessages);

      if (Array.isArray(historicContacts) && historicContacts.length > 0) {
        logger.info('messaging-history.set: syncing contacts to store', { count: historicContacts.length });
        registrarContactos(sock, historicContacts, 'messaging-history.set');
      }
    });

    // Cuentas Business "modernas" (con la UI de "Listas" en vez de "Etiquetas") no disparan
    // estos eventos: WhatsApp migró la feature a otra colección de app-state que Baileys
    // aún no decodifica como label. El endpoint /api/labels quedará vacío hasta que
    // Baileys soporte el nuevo protocolo. Cuentas Business antiguas con la UI de
    // "Etiquetas" clásicas sí funcionan.
    sock.ev.on('labels.edit', (label: any) => {
      if (!label?.id) return;
      labelStore.upsertLabel(sessionId, {
        id: String(label.id),
        name: String(label.name ?? ''),
        color: Number(label.color ?? 0),
        deleted: !!label.deleted,
        predefinedId: label.predefinedId != null ? String(label.predefinedId) : null,
        // Explícito aunque sea el valor por omisión: lo que llega por aquí lo cuenta
        // WhatsApp, y es lo que asciende una fila escrita en local.
        source: 'wa',
      }).catch(err =>
        logger.warn('labels.edit store error', { error: String(err) }),
      );
    });

    sock.ev.on('labels.association', ({ association, type }: any) => {
      if (!association?.labelId) return;
      const assocType = association.type === 'label_message' ? 'message' : 'chat';
      const chatJid = String(association.chatId ?? '');
      if (!chatJid) return;
      const payload = {
        labelId: String(association.labelId),
        type: assocType as 'chat' | 'message',
        chatJid,
        messageId: association.messageId != null ? String(association.messageId) : null,
      };
      const op = type === 'remove'
        ? labelStore.removeAssociation(sessionId, payload)
        : labelStore.addAssociation(sessionId, payload);
      op.catch(err => logger.warn('labels.association store error', { error: String(err) }));
    });

    sock.ev.on('creds.update', async () => {
      await authProvider.saveCreds();
    });

    sock.ev.on('messages.upsert', async (msgEvent) => {
      for (const msg of msgEvent.messages) {
        if (msg.key?.fromMe) continue;

        let jid = msg.key.remoteJid;
        if (!jid) continue;

        if (isLidUser(jid)) {
          try {
            const pnJid = await (sock as any).signalRepository?.lidMapping?.getPNForLID(jid);
            if (pnJid) {
              jid = jidNormalizedUser(pnJid);
            }
          } catch (err) {
            logger.warn('Failed to resolve LID to PN', { jid, error: String(err) });
          }
        }

        if (!jid.includes('@g.us') && !jid.includes('@broadcast') && !jid.endsWith('@newsletter')) {
          anotarRemitente(msg.key.remoteJid, jid, msg.pushName);
        }

        if (msg.message) {
          const emitted = Object.assign({}, msg, { key: { ...msg.key, remoteJid: jid } });
          eventBus.emit('message', emitted as any);
        } else {
          logger.info('messages.upsert skipped (no message, likely crypto retry)', { id: msg.key?.id, from: msg.key?.remoteJid, type: (msgEvent as any).type });
        }
      }
    });

    // Las llamadas. El consumidor no las atiende, pero que no quede rastro en la conversación es una
    // pérdida real: el agente ve un hueco donde el cliente intentó hablar con él.
    //
    // De una misma llamada llegan varios eventos (`offer` al sonar, y después `accept`,
    // `reject`, `timeout` o `terminate`). Salen todos con el mismo `id` para que el consumidor
    // los trate como actualizaciones de un registro, no como llamadas distintas.
    sock.ev.on('call', (llamadas: any[]) => {
      for (const llamada of llamadas ?? []) {
        const id = llamada?.id;
        const from = llamada?.from;
        if (!id || !from) continue;

        const chatId = String(llamada.chatId ?? from);
        const esOferta = llamada.status === 'offer';
        let autoRejected = false;

        if (esOferta && config.autoRejectCalls) {
          autoRejected = true;
          // A propósito sin `await`: colgar no puede retrasar la publicación del registro, y
          // si falla el rechazo la llamada simplemente sonará. Perder el rastro sería peor.
          Promise.resolve(sock.rejectCall(id, from)).catch((err: unknown) =>
            logger.warn('Failed to auto-reject call', { id, error: String(err) }),
          );
        }

        const fecha = llamada.date instanceof Date ? llamada.date : new Date();
        eventBus.emit('call', {
          id: String(id),
          chatId,
          from: String(from),
          isGroup: llamada.isGroup === true,
          isVideo: llamada.isVideo === true,
          status: String(llamada.status ?? 'offer'),
          timestamp: Math.floor(fecha.getTime() / 1000),
          offline: llamada.offline === true,
          ...(autoRejected ? { autoRejected: true } : {}),
        });
      }
    });

    const VALID_PRESENCES: ReadonlySet<PresenceType> = new Set(['composing', 'recording', 'paused', 'available', 'unavailable']);
    sock.ev.on('presence.update', ({ id, presences }: { id: string; presences: Record<string, { lastKnownPresence?: string; lastSeen?: number | null }> }) => {
      if (!id || !presences) return;
      const isGroup = id.endsWith('@g.us');
      const now = Date.now();
      for (const [participant, data] of Object.entries(presences)) {
        const raw = data?.lastKnownPresence;
        if (!raw || !VALID_PRESENCES.has(raw as PresenceType)) continue;
        eventBus.emit('presence.contact', {
          jid: id,
          isGroup,
          participant,
          presence: raw as PresenceType,
          lastSeen: typeof data.lastSeen === 'number' ? data.lastSeen : null,
          timestamp: now,
        });
      }
    });

    /**
     * `proto.Message.EventResponseMessage.EventResponseType`.
     *
     * El 0 (`UNKNOWN`) se deja fuera a propósito: no es una respuesta, y publicarlo haría que el
     * consumidor apuntara una confirmación que el invitado no ha dado.
     */
    const EVENT_RESPONSES: Record<number, 'going' | 'not_going' | 'maybe' | undefined> = {
      1: 'going',
      2: 'not_going',
      3: 'maybe',
    };

    const STATUS_LABELS: Record<number, MessageStatusLabel> = {
      0: 'error',
      1: 'pending',
      2: 'server-ack',
      3: 'delivered',
      4: 'read',
      5: 'played',
    };

    sock.ev.on('messages.update', async (updates) => {
      for (const { key, update } of updates) {
        if (key?.fromMe && typeof update.status === 'number' && key.id && key.remoteJid) {
          const rawStatus = update.status;
          const statusLabel = STATUS_LABELS[rawStatus];
          if (statusLabel) {
            // El acuse llega con el identificador opaco (`@lid`) mientras el mensaje se guardó
            // bajo el teléfono, así que sin traducirlo el consumidor no puede emparejarlos y el
            // doble check nunca avanza del primer tick. Es la misma resolución que ya hace
            // `messages.upsert`; faltaba aquí, que es la mitad silenciosa del problema.
            let chatJid = key.remoteJid;
            if (isLidUser(chatJid)) {
              try {
                const pnJid = await (sock as any).signalRepository?.lidMapping?.getPNForLID(chatJid);
                if (pnJid) chatJid = jidNormalizedUser(pnJid);
              } catch (err) {
                logger.warn('Failed to resolve LID to PN on ACK', { jid: chatJid, error: String(err) });
              }
            }

            const isGroup = chatJid.endsWith('@g.us');
            const phone = chatJid.endsWith('@s.whatsapp.net') ? (chatJid.split('@')[0] ?? null) : null;
            eventBus.emit('message.status', {
              messageId: key.id,
              status: rawStatus as MessageStatusCode,
              statusLabel,
              chatJid,
              phone,
              isGroup,
              fromMe: true,
              timestamp: Date.now(),
            });
            logger.debug('messages.update — ACK', { id: key.id, status: rawStatus, to: chatJid });
          }
        }

        /**
         * Confirmaciones de asistencia a una cita.
         *
         * No llegan como un mensaje: llegan **cifradas**, y Baileys las descifra por su cuenta y
         * las publica aquí, colgadas de la clave del **evento original**, no de la respuesta. Por
         * eso hay que atenderlas en `messages.update` y no en `messages.upsert`, donde nadie las
         * vería nunca.
         *
         * Solo se pueden leer las respuestas a eventos que mandó **esta línea**: el secreto para
         * descifrarlas vive dentro del mensaje de la invitación, y Baileys lo busca con
         * `getMessage`. Sin ese enganche —que WACore no tenía— escribe «event creation message
         * not found» y la respuesta se pierde. Que el original siga en la caché es, por tanto,
         * la condición para que esto funcione.
         */
        const respuestas = (update as any).eventResponses;
        if (Array.isArray(respuestas) && respuestas.length > 0 && key?.id && key?.remoteJid) {
          for (const r of respuestas) {
            const tipo = EVENT_RESPONSES[Number(r?.response?.response ?? 0)];
            if (!tipo) continue;

            const responderJid: string = r?.eventResponseMessageKey?.participant
              ?? r?.eventResponseMessageKey?.remoteJid
              ?? key.remoteJid;

            eventBus.emit('message.event_response', {
              id: r?.eventResponseMessageKey?.id ?? '',
              from: responderJid,
              phone: (responderJid.split('@')[0] ?? ''),
              pushName: '',
              isGroup: key.remoteJid.endsWith('@g.us'),
              groupId: key.remoteJid.endsWith('@g.us') ? key.remoteJid : null,
              timestamp: Math.floor(Number(r?.senderTimestampMs ?? Date.now()) / 1000),
              type: 'event_response',
              body: tipo,
              quotedMessage: null,
              media: null,
              sessionId,
              extras: {
                // La clave del evento al que contesta. Es lo único que permite casarla con la
                // actividad del consumidor, y sin ella la respuesta no significa nada.
                eventMessageId: key.id,
                eventChatJid: key.remoteJid,
                response: tipo,
                responderJid,
                extraGuestCount: Number(r?.response?.extraGuestCount ?? 0),
              },
            } as any);

            logger.info('messages.update — respuesta a una cita', { evento: key.id, respuesta: tipo });
          }
        }

        if (!update.message) continue;
        if (key?.fromMe) continue;
        const msg = { key, ...update } as any;
        const jid = key.remoteJid;
        if (jid && !jid.includes('@g.us') && !jid.includes('@broadcast') && !jid.endsWith('@newsletter')) {
          anotarRemitente(jid, jid, (update as any).pushName);
        }
        eventBus.emit('message', msg);
        logger.info('messages.update — decrypted after retry', { id: key.id, from: key.remoteJid });
      }
    });

    updateStatus('connecting');
    return sock;
  }

  return {
    get socket() { return socket; },

    async start() {
      logger.info('Starting Baileys client', { instance: config.instanceName });
      descartarCredencialesMuertas();
      await resolveWaVersion();

      // `start()` se llama más de una vez sobre el mismo cliente: `sessionManager.create()`
      // rearranca por aquí las líneas que encuentra caídas en el pool, y `whatsapp:check-sessions`
      // lo pide cada cinco minutos. Sin esta limpieza, cada vuelta dejaba vivo el temporizador
      // anterior y las subidas de pre-claves se multiplicaban solas.
      if (preKeyTimer) clearInterval(preKeyTimer);

      socket = buildSocket();
      preKeyTimer = setInterval(async () => {
        try {
          await socket?.uploadPreKeysToServerIfRequired?.();
        } catch (err) {
          logger.warn('Periodic pre-key upload failed', { error: String(err) });
        }
      }, 30 * 60 * 1000);
    },

    async connect() {
      if (socket) {
        const status = connectionStatus;
        if (status === 'connected' || status === 'connecting' || status === 'awaiting-qr') {
          logger.info('Already connecting/connected, skipping connect()', { status });
          return;
        }
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      descartarCredencialesMuertas();
      socket = buildSocket();
    },

    async stop() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (preKeyTimer) clearInterval(preKeyTimer);
      isStopping = true;

      if (socket) {
        try { await authProvider.state.save(); } catch {}
        try { socket?.ws?.close?.(); } catch {}
        socket = null;
      }
      updateStatus('disconnected');
      logger.info('Baileys client stopped');
    },

    async sendMessage(jid: string, content: any, options?: any) {
      if (!socket) throw new Error('Socket not initialized');
      return options === undefined
        ? await socket.sendMessage(jid, content)
        : await socket.sendMessage(jid, content, options);
    },

    async sendPresenceUpdate(jid: string, type: PresenceType) {
      if (!socket) throw new Error('Socket not initialized');
      await socket.sendPresenceUpdate(type, jid);
    },

    async presenceSubscribe(jid: string) {
      if (!socket) throw new Error('Socket not initialized');
      await socket.presenceSubscribe(jid);
    },

    async readMessages(keys) {
      if (!socket) throw new Error('Socket not initialized');
      await socket.readMessages(keys);
    },

    getConnectionStatus: () => connectionStatus,

    getQr: () => currentQr,

    getContacts: () => Array.from(contacts.values()),

    async resyncContacts() {
      // Dos peticiones a la vez harían dos snapshots; la segunda espera a la primera.
      if (resyncEnCurso) return resyncEnCurso;

      const sock = socket;
      if (!sock || connectionStatus !== 'connected') {
        throw new Error('La línea no está conectada');
      }

      resyncEnCurso = (async () => {
        const saltadosAntes = (globalThis as any).__wacoreAppStateSkipped ?? 0;

        // Sin versión guardada, Baileys pide la colección entera («snapshot»), que es lo mismo
        // que hace al emparejar: vuelve a llegar cada contacto de la agenda con su nombre.
        await (sock as any).authState.keys.set({ 'app-state-sync-version': { [COLECCION_AGENDA]: null } });
        await (sock as any).resyncAppState([COLECCION_AGENDA], true);
        await esperarAgendaGuardada();

        // Baileys guarda la versión nueva solo si la colección se sincronizó. Si se rindió
        // —lo hace en silencio— la versión sigue sin estar, y eso es lo que distingue «no se
        // pudo leer la agenda» de «esta agenda está vacía».
        const addressBookSynced = await colecciónSincronizada(sock);
        const skippedRecords = Math.max(0, ((globalThis as any).__wacoreAppStateSkipped ?? 0) - saltadosAntes);

        const [todos, guardados] = await Promise.all([
          contactStore.list(sessionId, { limit: 1 }),
          contactStore.list(sessionId, { limit: 1, onlyMyContacts: true }),
        ]);

        const resultado = {
          total: todos.total,
          inAddressBook: guardados.total,
          addressBookSynced,
          skippedRecords,
        };

        if (addressBookSynced) {
          logger.info('Agenda resincronizada', { sessionId, ...resultado });
        } else {
          logger.warn('WhatsApp no entregó la agenda de esta línea', { sessionId, ...resultado });
        }

        return resultado;
      })().finally(() => { resyncEnCurso = null; });

      return resyncEnCurso;
    },

    async uploadPreKeysToServerIfRequired() {
      try {
        await socket?.uploadPreKeysToServerIfRequired?.();
      } catch (err) {
        logger.warn('Pre-key upload failed', { error: String(err) });
      }
    },

    async logout() {
      if (socket) {
        try {
          await socket.logout();
        } catch (err) {
          logger.warn('Error during socket.logout(), cleaning up session anyway', { error: String(err) });
        }
        socket = null;
      }
      authProvider.invalidate();
      await sessionStore.delete();
      olvidarAgenda();
      updateStatus('logged-out');
    },
  };
}

function formatBaileysArg(arg: unknown): string {
  if (typeof arg === 'object' && arg !== null) {
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }
  return String(arg);
}

/**
 * Junta los argumentos de una llamada al log de Baileys en una línea legible.
 *
 * **Baileys habla pino, y pino pone el objeto primero y el texto después**:
 * `logger.warn({ msgId }, 'timed out waiting for message')`. Quedarse solo con `args[0]`
 * —que es lo que se hacía— tiraba el mensaje y dejaba en el log un `{"msgId":"31120.38820-210"}`
 * que no dice absolutamente nada. Costó una tarde averiguar que ese aviso mudo era WhatsApp sin
 * contestar a una consulta del catálogo.
 *
 * El texto va delante porque es lo que se lee de un vistazo; el objeto, detrás, como contexto.
 */
function formatBaileysArgs(args: unknown[]): string {
  const partes = args
    .filter((a) => a !== undefined)
    .map(formatBaileysArg)
    .filter((p) => p !== '' && p !== '{}');

  if (partes.length < 2) return partes[0] ?? '';

  // pino: (objeto, mensaje). Si el primero es un objeto y el segundo texto, se le da la vuelta.
  const [primero, ...resto] = partes;
  const objetoPrimero = typeof args[0] === 'object' && args[0] !== null && typeof args[1] === 'string';

  return objetoPrimero ? [...resto, primero].join(' ') : [primero, ...resto].join(' ');
}

function mapDisconnectReason(statusCode?: number): import('../types').DisconnectReason {
  switch (statusCode) {
    case 401: return 'loggedOut';
    case 403: return 'forbidden';
    case 405: return 'connectionReplaced';
    case 408: return 'timedOut';
    case 411: return 'multidevice';
    case 440: return 'connectionReplaced';
    case 500: return 'badSession';
    case 503: return 'unavailableService';
    case 515: return 'restartRequired';
    default: return 'unknown';
  }
}
