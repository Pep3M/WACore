import type { EventBus } from './event-bus';
import type { Logger } from '../utils/logger';
import type { NormalizedMessage, MessageHandler, MessageBufferConfig, PollMessagesResponse, WACoreEventName } from '../types';

export interface IncomingMessageHub {
  registerHandler(handler: MessageHandler): () => void;
  unregisterHandler(handler: MessageHandler): void;
  getRecentMessages(since?: string, limit?: number): PollMessagesResponse;
  start(): void;
  stop(): void;
}

const MESSAGE_EVENT_NAMES: WACoreEventName[] = [
  'message.text',
  'message.image',
  'message.video',
  'message.document',
  'message.audio',
  'message.reaction',
];

export function createIncomingMessageHub(eventBus: EventBus, logger: Logger, config: MessageBufferConfig): IncomingMessageHub {
  const buffer: NormalizedMessage[] = [];
  const handlers: MessageHandler[] = [];
  const maxSize = config.maxSize;
  const ttlMs = config.ttlMs;
  const unsubscribers: (() => void)[] = [];

  function push(msg: NormalizedMessage): void {
    if (buffer.length >= maxSize) {
      buffer.shift();
    }
    buffer.push(msg);
  }

  function getExpirationTimestamp(): number {
    return Date.now() - ttlMs;
  }

  function getRecentMessages(since?: string, limit: number = 50): PollMessagesResponse {
    const sinceTs = since ? new Date(since).getTime() : 0;
    const validSince = !isNaN(sinceTs) ? sinceTs : 0;
    const expiration = getExpirationTimestamp();

    const valid = buffer.filter(msg => {
      const msgTs = msg.timestamp * 1000;
      if (msgTs < expiration) return false;
      if (validSince > 0 && msgTs <= validSince) return false;
      return true;
    });

    valid.sort((a, b) => {
      const aTs = a.timestamp * 1000;
      const bTs = b.timestamp * 1000;
      return bTs - aTs;
    });

    const effectiveLimit = Math.max(1, Math.min(limit, 1000));
    const hasMore = valid.length > effectiveLimit;
    const messages = valid.slice(0, effectiveLimit);
    const lastMsg = messages[messages.length - 1];
    const cursor = lastMsg
      ? new Date(lastMsg.timestamp * 1000).toISOString()
      : null;

    return { messages, cursor, hasMore };
  }

  async function notifyHandlers(msg: NormalizedMessage): Promise<void> {
    for (const handler of handlers) {
      try {
        await handler(msg);
      } catch (err) {
        logger.error('Handler error', { error: String(err) });
      }
    }
  }

  function onMessage(msg: NormalizedMessage): void {
    push(msg);
    notifyHandlers(msg);
  }

  return {
    registerHandler(handler: MessageHandler): () => void {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    },

    unregisterHandler(handler: MessageHandler): void {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) handlers.splice(idx, 1);
    },

    getRecentMessages,

    start() {
      for (const eventName of MESSAGE_EVENT_NAMES) {
        const unsub = (eventBus.on as (event: string, handler: (msg: NormalizedMessage) => void | Promise<void>) => () => void)(eventName, onMessage);
        unsubscribers.push(unsub);
      }
      logger.info('Incoming message hub started', { maxSize, ttlMs });
    },

    stop() {
      for (const unsub of unsubscribers) {
        unsub();
      }
      unsubscribers.length = 0;
      handlers.length = 0;
      buffer.length = 0;
      logger.info('Incoming message hub stopped');
    },
  };
}
