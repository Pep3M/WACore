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

const CHATSTATE_TYPES: PresenceType[] = ['composing', 'recording', 'paused'];
const isChatstate = (t: PresenceType): boolean => CHATSTATE_TYPES.includes(t);

export function createPresenceManager(
  client: BaileysClient,
  config: EnvConfig,
  logger: Logger,
): PresenceManager {
  const typingTimers = new Map<string, ReturnType<typeof setInterval>>();
  const lastChatstate = new Map<string, PresenceType>();

  function resolveKey(jid: string): string {
    return normalizeJid(jid);
  }

  return {
    async setPresence(jid: string, type: PresenceType) {
      const key = resolveKey(jid);
      const fullJid = normalizeJid(jid);

      // Stop any active typing timer for this jid
      const timer = typingTimers.get(key);
      if (timer) {
        clearInterval(timer);
        typingTimers.delete(key);
      }

      // If switching between active chatstate types, send paused first to reset
      if (isChatstate(type)) {
        const prev = lastChatstate.get(key);
        if (prev && prev !== type && type !== 'paused') {
          await client.sendPresenceUpdate(fullJid, 'paused');
          await new Promise(r => setTimeout(r, 200));
        }
        if (type === 'paused') {
          lastChatstate.delete(key);
        } else {
          lastChatstate.set(key, type);
        }
      } else {
        lastChatstate.delete(key);
      }

      await client.sendPresenceUpdate(fullJid, type);
      logger.debug('Presence sent', { jid: fullJid, type });
    },

    startTyping(jid: string) {
      const key = resolveKey(jid);
      if (typingTimers.has(key)) return;
      const fullJid = normalizeJid(jid);
      client.sendPresenceUpdate(fullJid, 'composing').catch(() => {});
      const interval = setInterval(() => {
        client.sendPresenceUpdate(fullJid, 'composing').catch(() => {});
      }, config.typingDurationMs);
      typingTimers.set(key, interval);
      lastChatstate.set(key, 'composing');
      logger.debug('Typing started', { jid: fullJid });
    },

    stopTyping(jid: string) {
      const key = resolveKey(jid);
      const timer = typingTimers.get(key);
      if (timer) {
        clearInterval(timer);
        typingTimers.delete(key);
      }
      const fullJid = normalizeJid(jid);
      client.sendPresenceUpdate(fullJid, 'paused').catch(() => {});
      lastChatstate.delete(key);
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
      lastChatstate.clear();
      logger.info('Presence manager stopped, timers cleared');
    },
  };
}
