import {
  makeWASocket,
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
import type { EnvConfig, ConnectionStatus, PresenceType } from '../types';
import { createReconnectionManager } from '../core/reconnection';

export interface Contact {
  phone: string;
  name: string;
  jid: string;
}

export interface BaileysClient {
  socket: WASocket | null;
  start(): Promise<void>;
  stop(): Promise<void>;
  connect(): Promise<void>;
  sendMessage(jid: string, content: any): Promise<any>;
  sendPresenceUpdate(jid: string, type: PresenceType): Promise<void>;
  getConnectionStatus(): ConnectionStatus;
  getQr(): string | null;
  logout(): Promise<void>;
  getContacts(): Contact[];
  uploadPreKeysToServerIfRequired(): Promise<void>;
}

export async function createBaileysClient(
  config: EnvConfig,
  eventBus: EventBus,
  authProvider: AuthProvider,
  sessionStore: SessionStore,
  logger: Logger,
): Promise<BaileysClient> {
  let socket: WASocket | null = null;
  let connectionStatus: ConnectionStatus = 'disconnected';
  let currentQr: string | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let preKeyTimer: ReturnType<typeof setInterval> | null = null;
  let isStopping = false;
  const contacts = new Map<string, Contact>();

  const reconnection = createReconnectionManager(eventBus, logger);

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
      logger: {
        trace: (...args: any[]) => logger.debug(formatBaileysArg(args[0]), { source: 'baileys' }),
        debug: (...args: any[]) => logger.debug(formatBaileysArg(args[0]), { source: 'baileys' }),
        info: (...args: any[]) => logger.info(formatBaileysArg(args[0]), { source: 'baileys' }),
        warn: (...args: any[]) => logger.warn(formatBaileysArg(args[0]), { source: 'baileys' }),
        error: (...args: any[]) => logger.error(formatBaileysArg(args[0]), { source: 'baileys' }),
        child: () => {
          const childLogger = {
            trace: (...args: any[]) => logger.debug(formatBaileysArg(args[0]), { source: 'baileys.child' }),
            debug: (...args: any[]) => logger.debug(formatBaileysArg(args[0]), { source: 'baileys.child' }),
            info: (...args: any[]) => logger.info(formatBaileysArg(args[0]), { source: 'baileys.child' }),
            warn: (...args: any[]) => logger.warn(formatBaileysArg(args[0]), { source: 'baileys.child' }),
            error: (...args: any[]) => logger.error(formatBaileysArg(args[0]), { source: 'baileys.child' }),
            child: () => childLogger,
          };
          return childLogger;
        },
      } as any,
      syncFullHistory: false,
      fireInitQueries: true,
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
          socket = null;
          authProvider.invalidate();
          await sessionStore.delete();
          updateStatus('logged-out');
          eventBus.emit('auth.logged-out', {
            reason: String(reason),
            willReconnect: false,
          });
          return;
        }

        reconnection.recordFailure(reason);
        const delay = reconnection.getDelay(reason);

        updateStatus('connecting');
        socket = null;

        reconnectTimer = setTimeout(async () => {
          logger.info('Reconnecting...', { attempt: reconnection.getAttempt(), delay });
          socket = buildSocket();
        }, delay);
      }
    });

    sock.ev.on('contacts.upsert', (upserted: any[]) => {
      for (const c of upserted) {
        if (c.id && c.notify) {
          const phone = c.id.split('@')[0];
          contacts.set(phone, { phone, name: c.notify || c.name || c.verifiedName || phone, jid: c.id });
        }
      }
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

        if (!jid.includes('@g.us') && !jid.includes('@broadcast')) {
          const phone = jid.split('@')[0] ?? '';
          if (phone) {
            const pushName = msg.pushName || phone;
            if (!contacts.has(phone)) {
              contacts.set(phone, { phone, name: pushName, jid });
            } else {
              const existing = contacts.get(phone)!;
              if (pushName !== phone && existing.name === existing.phone) {
                existing.name = pushName;
              }
            }
          }
        }

        if (msg.message) {
          const emitted = Object.assign({}, msg, { key: { ...msg.key, remoteJid: jid } });
          eventBus.emit('message', emitted as any);
        } else {
          logger.info('messages.upsert skipped (no message, likely crypto retry)', { id: msg.key?.id, from: msg.key?.remoteJid, type: (msgEvent as any).type });
        }
      }
    });

    sock.ev.on('messages.update', (updates) => {
      for (const { key, update } of updates) {
        if (!update.message) continue;
        if (key?.fromMe) continue;
        const msg = { key, ...update } as any;
        const jid = key.remoteJid;
        if (jid && !jid.includes('@g.us') && !jid.includes('@broadcast')) {
          const phone = jid.split('@')[0] ?? '';
          if (phone && !contacts.has(phone)) {
            contacts.set(phone, { phone, name: update.pushName || phone, jid });
          }
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
      if (connectionStatus === 'logged-out') {
        logger.info('Resetting auth state for reconnection');
        authProvider.reset();
      }
      socket = buildSocket();
    },

    async stop() {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (preKeyTimer) clearInterval(preKeyTimer);
      isStopping = true;

      if (socket) {
        try { await authProvider.saveCreds(); } catch {}
        try { socket?.ws?.close?.(); } catch {}
        socket = null;
      }
      updateStatus('disconnected');
      logger.info('Baileys client stopped');
    },

    async sendMessage(jid: string, content: any) {
      if (!socket) throw new Error('Socket not initialized');
      return await socket.sendMessage(jid, content);
    },

    async sendPresenceUpdate(jid: string, type: PresenceType) {
      if (!socket) throw new Error('Socket not initialized');
      await socket.sendPresenceUpdate(type, jid);
    },

    getConnectionStatus: () => connectionStatus,

    getQr: () => currentQr,

    getContacts: () => Array.from(contacts.values()),

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
