import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import type { EnvConfig, PresenceType } from '../types';

export interface PresenceManager {
  setPresence(jid: string, type: PresenceType): Promise<void>;
  startTyping(jid: string): void;
  stopTyping(jid: string): void;
  sendWithTyping<T>(jid: string, sendFn: () => Promise<T>): Promise<T>;
  stop(): void;
}

function normalizeJid(jid: string): string {
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
}

export function createPresenceManager(
  client: BaileysClient,
  config: EnvConfig,
  logger: Logger,
): PresenceManager {
  const typingTimers = new Map<string, ReturnType<typeof setInterval>>();

  return {
    async setPresence(jid: string, type: PresenceType) {
      const fullJid = normalizeJid(jid);
      await client.sendPresenceUpdate(fullJid, type);
      logger.debug('Presence sent', { jid: fullJid, type });
    },

    startTyping(jid: string) {
      if (typingTimers.has(jid)) return;
      const fullJid = normalizeJid(jid);
      client.sendPresenceUpdate(fullJid, 'composing').catch(() => {});
      const interval = setInterval(() => {
        client.sendPresenceUpdate(fullJid, 'composing').catch(() => {});
      }, config.typingDurationMs);
      typingTimers.set(jid, interval);
      logger.debug('Typing started', { jid: fullJid });
    },

    stopTyping(jid: string) {
      const timer = typingTimers.get(jid);
      if (timer) {
        clearInterval(timer);
        typingTimers.delete(jid);
      }
      const fullJid = normalizeJid(jid);
      client.sendPresenceUpdate(fullJid, 'paused').catch(() => {});
      logger.debug('Typing stopped', { jid: fullJid });
    },

    async sendWithTyping<T>(jid: string, sendFn: () => Promise<T>): Promise<T> {
      if (!config.autoTyping) {
        return sendFn();
      }
      this.startTyping(jid);
      await new Promise(r => setTimeout(r, 800));
      try {
        return await sendFn();
      } finally {
        this.stopTyping(jid);
      }
    },

    stop() {
      for (const [jid, timer] of typingTimers) {
        clearInterval(timer);
      }
      typingTimers.clear();
      logger.info('Presence manager stopped, timers cleared');
    },
  };
}
