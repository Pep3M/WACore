import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
  type UserFacingSocketConfig,
} from 'baileys';
import type { Logger } from '../utils/logger';
import type { EventBus } from '../core/event-bus';
import type { AuthProvider } from './auth';
import type { SessionStore } from '../storage/session-store';
import type { EnvConfig, ConnectionStatus } from '../types';
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
  getConnectionStatus(): ConnectionStatus;
  getQr(): string | null;
  logout(): Promise<void>;
  getContacts(): Contact[];
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
        logger.info('WhatsApp connected', { phone });
      }

      if (connection === 'close') {
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
      logger.info('messages.upsert received', { count: msgEvent.messages.length, type: (msgEvent as any).type });
      for (const msg of msgEvent.messages) {
        const jid = msg.key.remoteJid;
        if (jid && !jid.includes('@g.us') && !jid.includes('@broadcast')) {
          const phone = jid.split('@')[0] ?? '';
          if (!phone) continue;
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
        eventBus.emit('message', msg as any);
        logger.info('Emitted message event', { id: msg.key?.id, from: msg.key?.remoteJid });
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
      if (socket) {
        try { socket?.logout?.(); } catch {}
        try { socket?.ws?.close?.(); } catch {}
        socket = null;
      }
      updateStatus('disconnected');
      await authProvider.saveCreds();
      logger.info('Baileys client stopped');
    },

    async sendMessage(jid: string, content: any) {
      if (!socket) throw new Error('Socket not initialized');
      return await socket.sendMessage(jid, content);
    },

    getConnectionStatus: () => connectionStatus,

    getQr: () => currentQr,

    getContacts: () => Array.from(contacts.values()),

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
