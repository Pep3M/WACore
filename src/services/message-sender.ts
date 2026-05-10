import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import type { EventBus } from '../core/event-bus';
import type { SendMediaRequest } from '../types';

export interface MessageSender {
  sendText(to: string, text: string): Promise<string>;
  sendMedia(req: SendMediaRequest): Promise<string>;
}

export function createMessageSender(
  client: BaileysClient,
  eventBus: EventBus,
  logger: Logger,
): MessageSender {
  return {
    async sendText(to: string, text: string): Promise<string> {
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      try {
        const result = await client.sendMessage(jid, { text });
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Message sent', { to: jid, messageId });
        return messageId;
      } catch (err) {
        logger.error('Failed to send text message', { to: jid, error: String(err) });
        throw err;
      }
    },

    async sendMedia(req: SendMediaRequest): Promise<string> {
      const jid = req.to.includes('@') ? req.to : `${req.to}@s.whatsapp.net`;

      let content: Record<string, unknown>;

      switch (req.type) {
        case 'image':
          content = { image: { url: req.url }, caption: req.caption, mimetype: req.mimetype };
          break;
        case 'video':
          content = { video: { url: req.url }, caption: req.caption, mimetype: req.mimetype };
          break;
        case 'document':
          content = { document: { url: req.url }, fileName: req.filename, caption: req.caption, mimetype: req.mimetype };
          break;
        case 'audio':
          content = { audio: { url: req.url }, mimetype: req.mimetype };
          break;
        default:
          throw new Error(`Unsupported media type: ${req.type}`);
      }

      try {
        const result = await client.sendMessage(jid, content);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Media sent', { to: jid, type: req.type, messageId });
        return messageId;
      } catch (err) {
        logger.error('Failed to send media message', { to: jid, type: req.type, error: String(err) });
        throw err;
      }
    },
  };
}
