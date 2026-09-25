import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import { MAX_LABEL_COLOR } from '../types/label';

export interface LabelWrite {
  id: string;
  name: string;
  color: number;
  deleted?: boolean;
}

export interface LabelManager {
  upsert(label: LabelWrite): Promise<void>;
  attachChat(chatJid: string, labelId: string): Promise<void>;
  detachChat(chatJid: string, labelId: string): Promise<void>;
  attachMessage(chatJid: string, messageId: string, labelId: string): Promise<void>;
  detachMessage(chatJid: string, messageId: string, labelId: string): Promise<void>;
}

export class InvalidLabelColorError extends Error {
  constructor(color: number) {
    super(`Invalid label color ${color}: WhatsApp only accepts 0-${MAX_LABEL_COLOR}`);
    this.name = 'InvalidLabelColorError';
  }
}

function normalizeJid(jid: string): string {
  if (jid.includes('@')) return jid;
  return `${jid}@s.whatsapp.net`;
}

/**
 * Escritura de etiquetas.
 *
 * Todo pasa por `chatModify`, o sea por un **parche del app-state de la cuenta**. Eso tiene una
 * consecuencia que conviene tener delante: un parche mal formado no da un error limpio, sino que
 * desincroniza el estado de la cuenta y obliga a un `resyncAppState`. Por eso el color se valida
 * aquí y no se confía en que el llamante mande algo sensato: WhatsApp solo admite veinte.
 */
export function createLabelManager(client: BaileysClient, logger: Logger): LabelManager {
  function requireSocket() {
    if (!client.socket) throw new Error('WhatsApp socket not connected');
    return client.socket as any;
  }

  return {
    async upsert(label: LabelWrite): Promise<void> {
      if (!Number.isInteger(label.color) || label.color < 0 || label.color > MAX_LABEL_COLOR) {
        throw new InvalidLabelColorError(label.color);
      }
      const sock = requireSocket();
      logger.debug('Writing label', { id: label.id, name: label.name });
      // El jid va vacío: crear o editar una etiqueta es un parche global de la cuenta, no de
      // una conversación concreta.
      await sock.addLabel('', {
        id: label.id,
        name: label.name,
        color: label.color,
        deleted: label.deleted ?? false,
      });
    },

    async attachChat(chatJid: string, labelId: string): Promise<void> {
      const sock = requireSocket();
      await sock.addChatLabel(normalizeJid(chatJid), labelId);
    },

    async detachChat(chatJid: string, labelId: string): Promise<void> {
      const sock = requireSocket();
      await sock.removeChatLabel(normalizeJid(chatJid), labelId);
    },

    async attachMessage(chatJid: string, messageId: string, labelId: string): Promise<void> {
      const sock = requireSocket();
      await sock.addMessageLabel(normalizeJid(chatJid), messageId, labelId);
    },

    async detachMessage(chatJid: string, messageId: string, labelId: string): Promise<void> {
      const sock = requireSocket();
      await sock.removeMessageLabel(normalizeJid(chatJid), messageId, labelId);
    },
  };
}
