import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import type { EventBus } from '../core/event-bus';
import type { SendMediaRequest, ForwardResult } from '../types';
import type { RawMessageCache, RawWAMessage } from './raw-message-cache';
import type { SentRegistry } from './sent-registry';

export interface RevokeOptions {
  fromMe?: boolean;
  participant?: string;
}

export interface ReactOptions {
  fromMe?: boolean;
  participant?: string;
}

export interface QuotedRef {
  id: string;
  participant?: string;
  fromMe?: boolean;
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface ButtonItem {
  id: string;
  title: string;
}

/** Una cita de calendario tal y como la manda el consumidor. Los tiempos van en segundos Unix. */
export interface EventInput {
  name: string;
  description?: string;
  startTime: number;
  endTime?: number;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  /** Añade una llamada de WhatsApp al evento. Incompatible con un enlace de reunión externo. */
  call?: 'audio' | 'video';
  isCancelled?: boolean;
  extraGuestsAllowed?: boolean;
}

/** Una ficha de producto del catálogo, para mandarla dentro de una conversación. */
export interface ProductCardInput {
  productId: string;
  title: string;
  description?: string;
  price: number;
  salePrice?: number;
  currency: string;
  retailerId?: string;
  url?: string;
  imageUrl: string;
  businessOwnerJid?: string;
  body?: string;
  footer?: string;
}

export interface MessageSender {
  sendText(to: string, text: string, quoted?: QuotedRef): Promise<string>;
  sendMedia(req: SendMediaRequest): Promise<string>;
  sendSticker(to: string, url: string, mimetype?: string): Promise<string>;
  sendLocation(to: string, latitude: number, longitude: number, name?: string, address?: string): Promise<string>;
  sendContact(to: string, displayName: string, contacts: { vcard: string }[]): Promise<string>;
  sendPtt(to: string, url: string, mimetype?: string): Promise<string>;
  sendList(to: string, body: string, sections: ListSection[], header?: string, footer?: string): Promise<string>;
  sendButtons(to: string, body: string, buttons: ButtonItem[], footer?: string): Promise<string>;
  revoke(chatId: string, messageId: string, opts?: RevokeOptions): Promise<void>;
  edit(chatId: string, messageId: string, text: string): Promise<string>;
  pin(chatId: string, messageId: string, pin: boolean, seconds?: number, fromMe?: boolean): Promise<string>;
  react(chatId: string, messageId: string, emoji: string, opts?: ReactOptions): Promise<void>;
  forward(fromChat: string, messageId: string, to: string[]): Promise<ForwardResult[]>;
  sendEvent(to: string, ev: EventInput): Promise<string>;
  sendProduct(to: string, card: ProductCardInput): Promise<string>;
}

/** `proto.Message.PinInChatMessage.Type`: fijar es 1, quitar el fijado es 2. */
const PIN_FOR_ALL = 1;
const UNPIN_FOR_ALL = 2;

function normalizeJid(to: string): string {
  return to.includes('@') ? to : `${to}@s.whatsapp.net`;
}

function buildQuotedStub(remoteJid: string, q: QuotedRef) {
  const key: { remoteJid: string; id: string; fromMe: boolean; participant?: string } = {
    remoteJid,
    id: q.id,
    fromMe: q.fromMe ?? false,
  };
  if (q.participant) key.participant = q.participant;
  return { key, message: { conversation: '' } };
}

export function createMessageSender(
  client: BaileysClient,
  eventBus: EventBus,
  logger: Logger,
  rawCache?: RawMessageCache,
  sentRegistry?: SentRegistry,
): MessageSender {
  function rememberSent(result: unknown): void {
    const msg = result as RawWAMessage | undefined;
    const id = msg?.key?.id;
    const remoteJid = msg?.key?.remoteJid;

    if (!id || !remoteJid) return;

    // El registro va aparte de la caché de reenvío y **sin** exigir `message`: lo único
    // que necesita es la clave, y es lo que permite reconocer el eco de este envío cuando
    // vuelva por `messages.upsert`.
    sentRegistry?.remember(remoteJid, id);

    if (msg.message) rawCache?.put(msg);
  }

  return {
    async sendText(to: string, text: string, quoted?: QuotedRef): Promise<string> {
      const jid = normalizeJid(to);
      const opts = quoted ? { quoted: buildQuotedStub(jid, quoted) } : undefined;
      try {
        const result = await client.sendMessage(jid, { text }, opts);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Message sent', { to: jid, messageId, quoted: quoted?.id });
        return messageId;
      } catch (err) {
        logger.error('Failed to send text message', { to: jid, error: String(err) });
        throw err;
      }
    },

    async sendMedia(req: SendMediaRequest): Promise<string> {
      const jid = normalizeJid(req.to);

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
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Media sent', { to: jid, type: req.type, messageId });
        return messageId;
      } catch (err) {
        logger.error('Failed to send media message', { to: jid, type: req.type, error: String(err) });
        throw err;
      }
    },

    async sendSticker(to: string, url: string, mimetype?: string): Promise<string> {
      const jid = normalizeJid(to);
      const content = { sticker: { url }, mimetype: mimetype ?? 'image/webp' };
      try {
        const result = await client.sendMessage(jid, content);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Sticker sent', { to: jid, messageId });
        return messageId;
      } catch (err) {
        logger.error('Failed to send sticker', { to: jid, error: String(err) });
        throw err;
      }
    },

    async sendLocation(to: string, latitude: number, longitude: number, name?: string, address?: string): Promise<string> {
      const jid = normalizeJid(to);
      const location: { degreesLatitude: number; degreesLongitude: number; name?: string; address?: string } = {
        degreesLatitude: latitude,
        degreesLongitude: longitude,
      };
      if (name !== undefined) location.name = name;
      if (address !== undefined) location.address = address;
      try {
        const result = await client.sendMessage(jid, { location });
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Location sent', { to: jid, messageId });
        return messageId;
      } catch (err) {
        logger.error('Failed to send location', { to: jid, error: String(err) });
        throw err;
      }
    },

    async sendContact(to: string, displayName: string, contacts: { vcard: string }[]): Promise<string> {
      const jid = normalizeJid(to);
      const content = { contacts: { displayName, contacts } };
      try {
        const result = await client.sendMessage(jid, content);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Contact sent', { to: jid, messageId, count: contacts.length });
        return messageId;
      } catch (err) {
        logger.error('Failed to send contact', { to: jid, error: String(err) });
        throw err;
      }
    },

    async sendPtt(to: string, url: string, mimetype?: string): Promise<string> {
      const jid = normalizeJid(to);
      const content = { audio: { url }, mimetype: mimetype ?? 'audio/ogg; codecs=opus', ptt: true };
      try {
        const result = await client.sendMessage(jid, content);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('PTT sent', { to: jid, messageId });
        return messageId;
      } catch (err) {
        logger.error('Failed to send PTT', { to: jid, error: String(err) });
        throw err;
      }
    },

    async sendList(to: string, body: string, sections: ListSection[], header?: string, footer?: string): Promise<string> {
      const jid = normalizeJid(to);
      const content: Record<string, unknown> = {
        listMessage: {
          title: header ?? '',
          description: body,
          buttonText: footer ?? 'Ver opciones',
          listType: 1,
          sections: sections.map(s => ({
            title: s.title,
            rows: s.rows.map(r => ({ rowId: r.id, title: r.title, description: r.description ?? '' })),
          })),
        },
      };
      try {
        const result = await client.sendMessage(jid, content);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('List message sent', { to: jid, messageId });
        return messageId;
      } catch (err) {
        // Baileys list messages can fail on older clients — caller is responsible for fallback
        logger.warn('Failed to send list message', { to: jid, error: String(err) });
        throw err;
      }
    },

    async sendButtons(to: string, body: string, buttons: ButtonItem[], footer?: string): Promise<string> {
      const jid = normalizeJid(to);
      const content: Record<string, unknown> = {
        buttonsMessage: {
          contentText: body,
          footerText: footer ?? '',
          buttons: buttons.map(b => ({
            buttonId: b.id,
            buttonText: { displayText: b.title },
            type: 1,
          })),
          headerType: 1,
        },
      };
      try {
        const result = await client.sendMessage(jid, content);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Buttons message sent', { to: jid, messageId });
        return messageId;
      } catch (err) {
        logger.warn('Failed to send buttons message', { to: jid, error: String(err) });
        throw err;
      }
    },

    /**
     * Manda una cita como **evento nativo** de WhatsApp: la tarjeta que el cliente puede añadir
     * a su calendario y contestar con «voy / no voy / quizá».
     *
     * Dos cosas que no son obvias:
     *
     * - **No se puede editar.** El contenido `event` de Baileys no admite `edit`, al revés que
     *   un texto o una encuesta. Cambiar una cita es volver a mandarla, y cancelarla es mandarla
     *   otra vez con `isCancelled`.
     * - **La respuesta del invitado viaja cifrada** con un secreto que Baileys guarda dentro de
     *   *este* mensaje. Si el original se pierde, la confirmación llega y no hay forma de leerla.
     *   Por eso se pasa por `rememberSent()` como cualquier otro envío.
     */
    async sendEvent(to: string, ev: EventInput): Promise<string> {
      const jid = normalizeJid(to);

      const contenido: Record<string, unknown> = {
        name: ev.name,
        description: ev.description,
        // Baileys quiere `Date`; el contrato de fuera son segundos Unix, que es lo que viaja por
        // HTTP sin que la zona horaria de nadie se meta por medio.
        startDate: new Date(ev.startTime * 1000),
        isCancelled: ev.isCancelled === true,
        extraGuestsAllowed: ev.extraGuestsAllowed === true,
      };

      if (typeof ev.endTime === 'number') contenido.endDate = new Date(ev.endTime * 1000);
      if (ev.call) contenido.call = ev.call;
      if (ev.location) {
        contenido.location = {
          degreesLatitude: ev.location.latitude,
          degreesLongitude: ev.location.longitude,
          name: ev.location.name,
          address: ev.location.address,
        };
      }

      try {
        const result = await client.sendMessage(jid, { event: contenido } as any);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Event sent', { to: jid, messageId, cancelled: ev.isCancelled === true });
        return messageId;
      } catch (err) {
        logger.error('Failed to send event', { to: jid, error: String(err) });
        throw err;
      }
    },

    /**
     * Manda la **ficha nativa** de un producto del catálogo, en vez de un texto con un enlace.
     *
     * El precio va en milésimas porque así se llama el campo del protocolo
     * (`priceAmount1000`); quien llama lo pasa en la unidad de la moneda y la conversión se hace
     * aquí, igual que en el gestor del catálogo.
     */
    async sendProduct(to: string, card: ProductCardInput): Promise<string> {
      const jid = normalizeJid(to);

      const producto: Record<string, unknown> = {
        productId: card.productId,
        title: card.title,
        description: card.description,
        currencyCode: card.currency,
        priceAmount1000: Math.round(card.price * 1000),
        retailerId: card.retailerId,
        url: card.url,
        productImage: { url: card.imageUrl },
        productImageCount: 1,
      };

      if (typeof card.salePrice === 'number') {
        producto.salePriceAmount1000 = Math.round(card.salePrice * 1000);
      }

      try {
        const result = await client.sendMessage(jid, {
          product: producto,
          businessOwnerJid: card.businessOwnerJid,
          body: card.body,
          footer: card.footer,
        } as any);
        rememberSent(result);
        const messageId = result?.key?.id ?? 'unknown';
        logger.debug('Product card sent', { to: jid, messageId, productId: card.productId });
        return messageId;
      } catch (err) {
        logger.error('Failed to send product card', { to: jid, error: String(err) });
        throw err;
      }
    },

    async revoke(chatId: string, messageId: string, opts?: RevokeOptions): Promise<void> {
      const jid = normalizeJid(chatId);
      const fromMe = opts?.fromMe ?? true;
      const key: { remoteJid: string; id: string; fromMe: boolean; participant?: string } = {
        remoteJid: jid,
        id: messageId,
        fromMe,
      };
      if (opts?.participant) key.participant = opts.participant;
      try {
        await client.sendMessage(jid, { delete: key });
        logger.debug('Message revoked', { to: jid, messageId, fromMe });
      } catch (err) {
        logger.error('Failed to revoke message', { to: jid, messageId, error: String(err) });
        throw err;
      }
    },

    /**
     * Reescribe un mensaje que salió de esta línea.
     *
     * WhatsApp no permite editar el mensaje de otro, así que la clave va siempre con
     * `fromMe: true`; pedirlo sobre un mensaje entrante lo rechaza la propia red.
     *
     * @returns el id del sobre de la edición, que **no** es el del mensaje editado.
     */
    async edit(chatId: string, messageId: string, text: string): Promise<string> {
      const jid = normalizeJid(chatId);
      const key = { remoteJid: jid, id: messageId, fromMe: true };
      try {
        const result = await client.sendMessage(jid, { text, edit: key });
        // Se registra como cualquier otro envío: la edición vuelve por `messages.upsert`
        // como eco propio y sin esto entraría marcada como escrita desde el móvil, lo que
        // despertaría al consumidor por algo que acabamos de hacer nosotros.
        rememberSent(result);
        logger.debug('Message edited', { to: jid, messageId });
        return result?.key?.id ?? 'unknown';
      } catch (err) {
        logger.error('Failed to edit message', { to: jid, messageId, error: String(err) });
        throw err;
      }
    },

    /**
     * Fija o desfija un mensaje en la conversación.
     *
     * WhatsApp lo modela como un mensaje más —`pinInChatMessage`— con la clave del mensaje
     * fijado dentro, no como una propiedad del chat. Por eso devuelve un id propio.
     *
     * `seconds` es cuánto dura el fijado, y **la aplicación solo ofrece tres valores**: 24
     * horas, 7 días y 30 días. Se acotan arriba, en la ruta.
     */
    async pin(chatId: string, messageId: string, pin: boolean, seconds?: number, fromMe?: boolean): Promise<string> {
      const jid = normalizeJid(chatId);
      const key = { remoteJid: jid, id: messageId, fromMe: fromMe ?? true };
      try {
        const result = await client.sendMessage(jid, {
          pin: key,
          type: pin ? PIN_FOR_ALL : UNPIN_FOR_ALL,
          ...(pin && seconds ? { time: seconds } : {}),
        } as never);
        rememberSent(result);
        logger.debug('Message pin changed', { to: jid, messageId, pin });
        return result?.key?.id ?? 'unknown';
      } catch (err) {
        logger.error('Failed to pin message', { to: jid, messageId, pin, error: String(err) });
        throw err;
      }
    },

    async react(chatId: string, messageId: string, emoji: string, opts?: ReactOptions): Promise<void> {
      const jid = normalizeJid(chatId);
      const fromMe = opts?.fromMe ?? true;
      const key: { remoteJid: string; id: string; fromMe: boolean; participant?: string } = {
        remoteJid: jid,
        id: messageId,
        fromMe,
      };
      if (opts?.participant) key.participant = opts.participant;
      try {
        await client.sendMessage(jid, { react: { text: emoji, key } });
        logger.debug('Reaction sent', { to: jid, messageId, emoji, fromMe });
      } catch (err) {
        logger.error('Failed to send reaction', { to: jid, messageId, error: String(err) });
        throw err;
      }
    },

    async forward(fromChat: string, messageId: string, to: string[]): Promise<ForwardResult[]> {
      const sourceJid = normalizeJid(fromChat);
      const raw = rawCache?.get(sourceJid, messageId);
      const results: ForwardResult[] = [];
      for (const dest of to) {
        const destJid = normalizeJid(dest);
        if (!raw) {
          results.push({ to: destJid, id: null, ok: false, error: 'not_found' });
          continue;
        }
        try {
          const result = await client.sendMessage(destJid, { forward: raw });
          rememberSent(result);
          const newId = result?.key?.id ?? null;
          eventBus.emit('message.forwarded', {
            from: sourceJid,
            sourceMessageId: messageId,
            to: destJid,
            newMessageId: newId,
            timestamp: Date.now(),
          });
          results.push({ to: destJid, id: newId, ok: true });
        } catch (err) {
          logger.error('Failed to forward message', { to: destJid, sourceMessageId: messageId, error: String(err) });
          results.push({ to: destJid, id: null, ok: false, error: String(err) });
        }
      }
      return results;
    },
  };
}
