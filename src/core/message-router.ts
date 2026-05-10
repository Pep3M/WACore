import type { EventBus } from './event-bus';
import type { Logger } from '../utils/logger';
import type { NormalizedMessage, MessageType, WACoreEventName } from '../types';

export interface MessageRouter {
  start(): void;
  stop(): void;
}

const MESSAGE_EVENTS: Record<MessageType, WACoreEventName> = {
  text: 'message.text',
  image: 'message.image',
  video: 'message.video',
  document: 'message.document',
  audio: 'message.audio',
  reaction: 'message.reaction',
  unknown: 'message.text',
};

export function createMessageRouter(eventBus: EventBus, logger: Logger): MessageRouter {
  function normalize(raw: any): NormalizedMessage | null {
    try {
      if (raw.key?.fromMe) return null;

      const type = detectMessageType(raw);
      if (!type) return null;

      return {
        id: raw.key?.id ?? '',
        from: raw.key?.remoteJid ?? '',
        phone: extractPhone(raw.key?.remoteJid ?? ''),
        pushName: raw.pushName ?? '',
        isGroup: (raw.key?.remoteJid ?? '').endsWith('@g.us'),
        groupId: (raw.key?.remoteJid ?? '').endsWith('@g.us') ? raw.key?.remoteJid ?? null : null,
        timestamp: extractTimestamp(raw.messageTimestamp),
        type,
        body: extractBody(raw, type),
        quotedMessage: extractQuoted(raw),
        media: extractMedia(raw, type),
      };
    } catch (err) {
      logger.error('Failed to normalize message', { error: String(err) });
      return null;
    }
  }

  return {
    start() {
      eventBus.on('message', (raw: any) => {
        const normalized = normalize(raw);
        if (!normalized) {
          logger.info('Message normalization returned null', { rawKeys: Object.keys(raw), hasMessage: !!raw?.message });
          return;
        }
        const targetEvent = MESSAGE_EVENTS[normalized.type] ?? 'message.text';
        logger.info('Message normalized', { type: normalized.type, from: normalized.phone, body: normalized.body?.slice(0, 50) });
        eventBus.emit(targetEvent, normalized);
      });
      logger.info('Message router started');
    },

    stop() {
      logger.info('Message router stopped');
    },
  };
}

function detectMessageType(raw: any): MessageType | null {
  if (raw.message?.conversation) return 'text';
  if (raw.message?.extendedTextMessage) return 'text';
  if (raw.message?.imageMessage) return 'image';
  if (raw.message?.videoMessage) return 'video';
  if (raw.message?.documentMessage) return 'document';
  if (raw.message?.audioMessage) return 'audio';
  if (raw.message?.reactionMessage) return 'reaction';
  return null;
}

function extractBody(raw: any, type: MessageType): string | null {
  const msg = raw.message ?? {};
  switch (type) {
    case 'text': return msg.conversation ?? msg.extendedTextMessage?.text ?? null;
    case 'image': return msg.imageMessage?.caption ?? null;
    case 'video': return msg.videoMessage?.caption ?? null;
    case 'document': return msg.documentMessage?.caption ?? null;
    case 'reaction': return msg.reactionMessage?.text ?? null;
    default: return null;
  }
}

function extractQuoted(raw: any): NormalizedMessage['quotedMessage'] {
  const context = raw.message?.extendedTextMessage?.contextInfo;
  if (!context?.quotedMessage) return null;
  return {
    id: context.stanzaId ?? '',
    from: context.participant ?? '',
    body: JSON.stringify(context.quotedMessage),
    type: 'text',
  };
}

function extractMedia(raw: any, type: MessageType): NormalizedMessage['media'] {
  const msg = raw.message ?? {};
  switch (type) {
    case 'image': return { mimetype: msg.imageMessage?.mimetype ?? 'image/jpeg', caption: msg.imageMessage?.caption };
    case 'video': return { mimetype: msg.videoMessage?.mimetype ?? 'video/mp4', caption: msg.videoMessage?.caption };
    case 'document': return { mimetype: msg.documentMessage?.mimetype ?? 'application/octet-stream', filename: msg.documentMessage?.fileName, caption: msg.documentMessage?.caption };
    case 'audio': return { mimetype: msg.audioMessage?.mimetype ?? 'audio/ogg' };
    default: return null;
  }
}

function extractPhone(jid: string): string {
  return jid.split('@')[0] ?? jid;
}

function extractTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (ts && typeof ts === 'object' && 'low' in ts) {
    const long = ts as { low: number; high: number };
    return long.low + long.high * 0x100000000;
  }
  return Math.floor(Date.now() / 1000);
}
