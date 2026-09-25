import { describe, expect, it, mock } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createMessageRouter } from '../core/message-router';
import { createLogger } from '../utils/logger';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9878',
};
const logger = createLogger(mockConfig);

function makeRawMessage(overrides: Record<string, any> = {}): any {
  return {
    key: { remoteJid: '123456@s.whatsapp.net', id: 'msg-001', fromMe: false },
    message: { conversation: 'Hello' },
    messageTimestamp: 1000000,
    pushName: 'TestUser',
    ...overrides,
  };
}

describe('MessageRouter', () => {
  it('normalizes text messages and emits typed event', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message.text', handler);
    router.start();

    const raw = makeRawMessage();
    bus.emit('message', raw);

    expect(handler).toHaveBeenCalledTimes(1);
    const normalized = handler.mock.calls[0]?.[0];
    expect(normalized.type).toBe('text');
    expect(normalized.body).toBe('Hello');
    expect(normalized.phone).toBe('123456');
    expect(normalized.from).toBe('123456@s.whatsapp.net');
    expect(normalized.isGroup).toBe(false);
    expect(normalized.pushName).toBe('TestUser');
  });

  it('emits type-specific events for each message type', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const textHandler = mock();
    const imageHandler = mock();

    bus.on('message.text', textHandler);
    bus.on('message.image', imageHandler);
    router.start();

    const raw = makeRawMessage({
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Photo' } },
    });
    bus.emit('message', raw);

    expect(textHandler).not.toHaveBeenCalled();
    expect(imageHandler).toHaveBeenCalledTimes(1);
    expect(imageHandler.mock.calls[0]?.[0].type).toBe('image');
  });

  it('handles group messages', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message.text', handler);
    router.start();

    const raw = makeRawMessage({
      key: { remoteJid: '123-456@g.us', id: 'msg-002', fromMe: false },
    });
    bus.emit('message', raw);

    const msg = handler.mock.calls[0]?.[0];
    expect(msg.isGroup).toBe(true);
    expect(msg.groupId).toBe('123-456@g.us');
  });

  it('handles reaction messages', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message.reaction', handler);
    router.start();

    const raw = makeRawMessage({
      message: { reactionMessage: { text: '👍', key: {} } },
    });
    bus.emit('message', raw);

    const msg = handler.mock.calls[0]?.[0];
    expect(msg.type).toBe('reaction');
    expect(msg.body).toBe('👍');
  });

  it('detects sticker messages', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.sticker', handler);
    router.start();
    bus.emit('message', makeRawMessage({ message: { stickerMessage: { mimetype: 'image/webp' } } }));
    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0]?.[0];
    expect(msg.type).toBe('sticker');
    expect(msg.media?.mimetype).toBe('image/webp');
  });

  it('detects location messages and populates extras', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.location', handler);
    router.start();
    bus.emit('message', makeRawMessage({
      message: { locationMessage: { degreesLatitude: 19.4326, degreesLongitude: -99.1332, name: 'CDMX' } },
    }));
    const msg = handler.mock.calls[0]?.[0];
    expect(msg.type).toBe('location');
    expect(msg.body).toBe('19.4326,-99.1332');
    expect(msg.extras).toEqual({ latitude: 19.4326, longitude: -99.1332, name: 'CDMX' });
  });

  it('detects contact messages and puts vcards in extras', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();
    bus.on('message.contact', handler);
    router.start();
    bus.emit('message', makeRawMessage({
      message: { contactMessage: { displayName: 'Juan', vcard: 'BEGIN:VCARD\nEND:VCARD' } },
    }));
    const msg = handler.mock.calls[0]?.[0];
    expect(msg.type).toBe('contact');
    expect(msg.body).toBe('Juan');
    expect(msg.extras).toEqual({ displayName: 'Juan', contacts: [{ vcard: 'BEGIN:VCARD\nEND:VCARD' }] });
  });

  it('detects PTT vs plain audio via ptt flag', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const pttHandler = mock();
    const audioHandler = mock();
    bus.on('message.ptt', pttHandler);
    bus.on('message.audio', audioHandler);
    router.start();

    bus.emit('message', makeRawMessage({ message: { audioMessage: { mimetype: 'audio/ogg', ptt: true } } }));
    bus.emit('message', makeRawMessage({ message: { audioMessage: { mimetype: 'audio/mp3' } } }));

    expect(pttHandler).toHaveBeenCalledTimes(1);
    expect(audioHandler).toHaveBeenCalledTimes(1);
    expect(pttHandler.mock.calls[0]?.[0].type).toBe('ptt');
    expect(pttHandler.mock.calls[0]?.[0].extras).toEqual({ ptt: true });
    expect(audioHandler.mock.calls[0]?.[0].type).toBe('audio');
  });

  // ─── Mensajes propios ─────────────────────────────────────────────────────
  //
  // Lo que sale de la línea vuelve por `messages.upsert` con `fromMe: true`, lo escriba el
  // consumidor por la API o una persona desde el móvil. La bandera decide si se publica y el
  // `origin` decide qué hacer con cada copia.

  describe('mensajes propios', () => {
    function propio(overrides: Record<string, any> = {}): any {
      return makeRawMessage({
        key: { remoteJid: '123456@s.whatsapp.net', id: 'msg-mio', fromMe: true },
        pushName: 'Mi Empresa',
        ...overrides,
      });
    }

    it('por omisión no se publican', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger);
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio());

      expect(handler).not.toHaveBeenCalled();
    });

    it('la bandera apagada explícitamente tampoco los publica', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: false });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio());

      expect(handler).not.toHaveBeenCalled();
    });

    it('con la bandera encendida salen marcados como propios', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio());

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0].fromMe).toBe(true);
    });

    it('lo enviado por la API llega con origin api', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio({ _origin: 'api' }));

      expect(handler.mock.calls[0]?.[0].origin).toBe('api');
    });

    it('lo escrito desde el móvil llega con origin device', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio({ _origin: 'device' }));

      expect(handler.mock.calls[0]?.[0].origin).toBe('device');
    });

    it('sin sello se asume device, que es la lectura prudente', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio());

      // Procesar de más un mensaje nuestro es recuperable; perder el que escribió una
      // persona, no.
      expect(handler.mock.calls[0]?.[0].origin).toBe('device');
    });

    it('un sello inventado no se cuela como api', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio({ _origin: 'cualquier-cosa' }));

      expect(handler.mock.calls[0]?.[0].origin).toBe('device');
    });

    it('el pushName propio no viaja: es nuestro nombre, no el del contacto', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio());

      // Si viajara, el consumidor lo tomaría por el nombre del interlocutor y machacaría el del
      // cliente en su ficha.
      expect(handler.mock.calls[0]?.[0].pushName).toBe('');
    });

    it('el acuse que ya trae el mensaje viaja con el eco', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio({ status: 4 }));

      // Sin esto el consumidor lo guardaría como recién enviado y el doble check azul
      // bajaría a un tick.
      expect(handler.mock.calls[0]?.[0].ack).toBe(4);
    });

    it('un acuse que no es numérico se omite en lugar de inventarse', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', propio({ status: 'READ' }));

      expect(handler.mock.calls[0]?.[0].ack).toBeUndefined();
    });

    it('un adjunto propio conserva su mediaId para poder descargarlo', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.image', handler);
      router.start();
      bus.emit('message', propio({
        message: { imageMessage: { mimetype: 'image/jpeg', caption: 'foto' } },
      }));

      const msg = handler.mock.calls[0]?.[0];
      expect(msg.type).toBe('image');
      expect(msg.media?.mediaId).toBe('msg-mio');
      expect(msg.body).toBe('foto');
    });

    it('un mensaje entrante nunca sale marcado como propio', () => {
      const bus = createEventBus();
      const router = createMessageRouter(bus, logger, { publishFromMe: true });
      const handler = mock();

      bus.on('message.text', handler);
      router.start();
      bus.emit('message', makeRawMessage({ status: 2, _origin: 'api' }));

      const msg = handler.mock.calls[0]?.[0];
      expect(msg.fromMe).toBe(false);
      expect(msg.origin).toBeUndefined();
      expect(msg.ack).toBeUndefined();
      expect(msg.pushName).toBe('TestUser');
    });
  });

  it('ignores unknown message types silently', () => {
    const bus = createEventBus();
    const router = createMessageRouter(bus, logger);
    const handler = mock();

    bus.on('message', handler);
    router.start();

    const raw = makeRawMessage({
      message: { bogusMessage: {} },
    });
    bus.emit('message', raw);

    expect(handler).toHaveBeenCalledTimes(1);
    const msg = handler.mock.calls[0]?.[0];
    expect(msg.message?.bogusMessage).toBeDefined();
  });
});
