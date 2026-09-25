import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import type { LastMessageTracker, TrackedMessage } from './last-message-tracker';

export class MissingLastMessageError extends Error {
  constructor(chatJid: string) {
    super(
      `No last message known for ${chatJid}. This operation needs one, and WhatsApp silently ` +
      'ignores the patch when it is wrong. Send lastMessage in the body, or wait until a message ' +
      'arrives in that chat.',
    );
    this.name = 'MissingLastMessageError';
  }
}

export interface ChatManager {
  archive(chatJid: string, archive: boolean, last?: TrackedMessage): Promise<void>;
  markRead(chatJid: string, read: boolean, last?: TrackedMessage): Promise<void>;
  remove(chatJid: string, last?: TrackedMessage): Promise<void>;
  pin(chatJid: string, pin: boolean): Promise<void>;
  mute(chatJid: string, muteEndTimestamp: number | null): Promise<void>;
  block(chatJid: string, block: boolean): Promise<void>;
}

function normalizeJid(jid: string): string {
  if (jid.includes('@')) return jid;
  return `${jid}@s.whatsapp.net`;
}

/**
 * Acciones sobre una conversación: archivar, fijar, silenciar, marcar y bloquear.
 *
 * Casi todo va por `chatModify`, o sea por parches del app-state de la cuenta. Dos cosas que hay
 * que tener delante y que no se deducen leyendo la firma:
 *
 * 1. **`archive`, `markRead` y `delete` exigen `lastMessages`**, y su último elemento tiene que
 *    ser el último mensaje recibido de verdad. Si no lo es, WhatsApp **acepta el parche y no hace
 *    nada**: no hay error que capturar. Por eso aquí se lanza antes de enviar cuando no se
 *    conoce, en vez de mandar algo a ciegas y devolver un 200 mentiroso.
 * 2. **`mute` es un instante absoluto de fin, no una duración.** Pasar «3600» silenciaría hasta
 *    1970. `null` quita el silencio.
 */
export function createChatManager(
  client: BaileysClient,
  tracker: LastMessageTracker,
  logger: Logger,
): ChatManager {
  function requireSocket() {
    if (!client.socket) throw new Error('WhatsApp socket not connected');
    return client.socket as any;
  }

  /** El último mensaje del chat, el que digan o el que tengamos; si no hay, se para aquí. */
  function lastMessages(jid: string, explicito?: TrackedMessage): TrackedMessage[] {
    const ultimo = explicito ?? tracker.get(jid);
    if (!ultimo) throw new MissingLastMessageError(jid);
    return [ultimo];
  }

  return {
    async archive(chatJid: string, archive: boolean, last?: TrackedMessage): Promise<void> {
      const jid = normalizeJid(chatJid);
      const sock = requireSocket();
      await sock.chatModify({ archive, lastMessages: lastMessages(jid, last) }, jid);
      logger.debug('Chat archive changed', { jid, archive });
    },

    async markRead(chatJid: string, read: boolean, last?: TrackedMessage): Promise<void> {
      const jid = normalizeJid(chatJid);
      const sock = requireSocket();
      await sock.chatModify({ markRead: read, lastMessages: lastMessages(jid, last) }, jid);
      logger.debug('Chat read state changed', { jid, read });
    },

    async remove(chatJid: string, last?: TrackedMessage): Promise<void> {
      const jid = normalizeJid(chatJid);
      const sock = requireSocket();
      await sock.chatModify({ delete: true, lastMessages: lastMessages(jid, last) }, jid);
      logger.debug('Chat deleted', { jid });
    },

    async pin(chatJid: string, pin: boolean): Promise<void> {
      const jid = normalizeJid(chatJid);
      const sock = requireSocket();
      await sock.chatModify({ pin }, jid);
      logger.debug('Chat pin changed', { jid, pin });
    },

    async mute(chatJid: string, muteEndTimestamp: number | null): Promise<void> {
      const jid = normalizeJid(chatJid);
      const sock = requireSocket();
      await sock.chatModify({ mute: muteEndTimestamp }, jid);
      logger.debug('Chat mute changed', { jid, muteEndTimestamp });
    },

    async block(chatJid: string, block: boolean): Promise<void> {
      const jid = normalizeJid(chatJid);
      const sock = requireSocket();
      // El bloqueo no es un parche de app-state: va por su propia consulta.
      await sock.updateBlockStatus(jid, block ? 'block' : 'unblock');
      logger.debug('Block status changed', { jid, block });
    },
  };
}
