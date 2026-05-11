import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import type { EnvConfig, PresenceType } from '../types';

export interface PresenceManager {
  setPresence(jid: string, type: PresenceType, durationMs?: number): Promise<void>;
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
  const typingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  const lastChatstate = new Map<string, PresenceType>();

  function resolveKey(jid: string): string {
    return normalizeJid(jid);
  }

  function clearPresenceRefresh(key: string) {
    const timer = typingTimers.get(key);
    if (timer) {
      clearInterval(timer);
      typingTimers.delete(key);
    }
    const existingTimeout = typingTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      typingTimeouts.delete(key);
    }
  }

  function stopPresenceRefresh(key: string, jid: string) {
    clearPresenceRefresh(key);
    lastChatstate.delete(key);
    client.sendPresenceUpdate(jid, 'paused').catch(() => {});
  }

  function startPresenceRefresh(key: string, jid: string, type: 'composing' | 'recording') {
    if (typingTimers.has(key)) return;
    client.sendPresenceUpdate(jid, type).catch(() => {});
    const interval = setInterval(() => {
      client.sendPresenceUpdate(jid, type).catch(() => {});
    }, config.typingDurationMs);
    typingTimers.set(key, interval);
    lastChatstate.set(key, type);
  }

  return {
    async setPresence(jid: string, type: PresenceType, durationMs?: number) {
      const key = resolveKey(jid);
      const fullJid = normalizeJid(jid);
      logger.info('setPresence called', { jid, fullJid, type, key, hasTimer: typingTimers.has(key), durationMs });

      clearPresenceRefresh(key);

      if (isChatstate(type)) {
        if (type === 'paused') {
          lastChatstate.delete(key);
        } else {
          lastChatstate.set(key, type);
        }
      } else {
        lastChatstate.delete(key);
      }

      if (durationMs && durationMs > 0 && (type === 'composing' || type === 'recording')) {
        startPresenceRefresh(key, fullJid, type);
        const timeout = setTimeout(() => {
          stopPresenceRefresh(key, fullJid);
          logger.info('Presence auto-paused after duration', { jid: fullJid, type, durationMs });
        }, durationMs);
        typingTimeouts.set(key, timeout);
        logger.info('Presence will auto-pause with refresh', { jid: fullJid, type, durationMs });
      } else {
        try {
          await client.sendPresenceUpdate(fullJid, type);
          logger.info('Presence update sent successfully', { jid: fullJid, type });
        } catch (err) {
          logger.error('Presence update failed', { jid: fullJid, type, error: String(err) });
          throw err;
        }
      }
    },

    startTyping(jid: string) {
      const key = resolveKey(jid);
      const fullJid = normalizeJid(jid);
      logger.debug('Typing started', { jid: fullJid });
      startPresenceRefresh(key, fullJid, 'composing');
    },

    stopTyping(jid: string) {
      const key = resolveKey(jid);
      const fullJid = normalizeJid(jid);
      logger.debug('Typing stopped', { jid: fullJid });
      stopPresenceRefresh(key, fullJid);
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
      for (const timer of typingTimers.values()) {
        clearInterval(timer);
      }
      for (const timeout of typingTimeouts.values()) {
        clearTimeout(timeout);
      }
      typingTimers.clear();
      typingTimeouts.clear();
      lastChatstate.clear();
      logger.info('Presence manager stopped, timers cleared');
    },
  };
}
