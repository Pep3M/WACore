import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import type { EventBus } from '../core/event-bus';
import type { EnvConfig } from '../types';

export interface ReadReceiptManager {
  sendReadReceipt(to: string, messageIds: string[], participant?: string): Promise<void>;
  start(): void;
  stop(): void;
}

function normalizeJid(jid: string): string {
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
}

export function createReadReceiptManager(
  client: BaileysClient,
  eventBus: EventBus,
  config: EnvConfig,
  logger: Logger,
): ReadReceiptManager {
  let unsubscribe: (() => void) | null = null;

  return {
    async sendReadReceipt(to: string, messageIds: string[], participant?: string): Promise<void> {
      const jid = normalizeJid(to);

      const keys = messageIds.map(id => {
        const key: {
          remoteJid: string;
          id: string;
          fromMe: boolean;
          participant?: string;
        } = {
          remoteJid: jid,
          id,
          fromMe: false,
        };
        if (participant) {
          key.participant = normalizeJid(participant);
        }
        return key;
      });

      await client.readMessages(keys);
    },

    start() {
      if (!config.autoRead) {
        logger.info('Auto-read disabled');
        return;
      }

      // Unsubscribe first if already subscribed (idempotent)
      unsubscribe?.();

      unsubscribe = eventBus.on('message', (raw: any) => {
        const jid = raw?.key?.remoteJid;
        const id = raw?.key?.id;
        if (!jid || !id) return;

        const participant = raw?.key?.participant;

        this.sendReadReceipt(jid, [id], participant).catch(err => {
          logger.warn('Auto-read failed', { jid, id, error: String(err) });
        });
      });

      logger.info('Auto-read enabled');
    },

    stop() {
      unsubscribe?.();
      unsubscribe = null;
      logger.info('Read receipt manager stopped');
    },
  };
}
