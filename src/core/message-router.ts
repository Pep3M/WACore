import type { EventBus } from './event-bus';
import type { Logger } from '../utils/logger';
import type { NormalizedMessage, MessageType, WACoreEventName } from '../types';
import { normalizeMessage } from './normalize-message';

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
  ptt: 'message.ptt',
  sticker: 'message.sticker',
  location: 'message.location',
  contact: 'message.contact',
  reaction: 'message.reaction',
  order: 'message.order',
  product: 'message.product',
  event: 'message.event',
  event_response: 'message.event_response',
  unknown: 'message.text',
};

export interface MessageRouterOptions {
  /**
   * Publicar también los mensajes que salen de la línea.
   *
   * Lo que un comercial escribe desde su propio móvil no existe para el consumidor mientras esto
   * esté apagado. Se enciende cuando el consumidor sabe descartar el eco de sus propios
   * envíos, que llegan marcados con `origin: 'api'`.
   */
  publishFromMe?: boolean;
}

export function createMessageRouter(
  eventBus: EventBus,
  logger: Logger,
  opts: MessageRouterOptions = {},
): MessageRouter {
  const publishFromMe = opts.publishFromMe === true;

  function normalize(raw: any): NormalizedMessage | null {
    try {
      return normalizeMessage(raw, { publishFromMe });
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
        logger.info('Message normalized', {
          type: normalized.type,
          from: normalized.phone,
          fromMe: normalized.fromMe,
          origin: normalized.origin,
          body: normalized.body?.slice(0, 50),
        });
        eventBus.emit(targetEvent, normalized);
      });
      // El histórico entra por su propia puerta: normalizarlo con el mismo código evita que el
      // volcado y lo que llega en vivo acaben con formas distintas en la misma conversación.
      //
      // Se le deja pasar lo propio **siempre**, sin mirar `publishFromMe`: esa bandera existe
      // para que el eco de un envío no duplique lo que el consumidor ya tiene guardado, y en un volcado
      // no hay nada guardado. Con ella apagada, el histórico llegaría con media conversación.
      eventBus.on('history.message', (raw: any) => {
        let normalized: NormalizedMessage | null = null;

        try {
          normalized = normalizeMessage(raw, { publishFromMe: true });
        } catch (err) {
          logger.error('Failed to normalize history message', { error: String(err) });
          return;
        }

        if (!normalized) return;

        eventBus.emit('message.history', normalized);
      });

      logger.info('Message router started');
    },

    stop() {
      logger.info('Message router stopped');
    },
  };
}
