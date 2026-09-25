import { describe, expect, it, mock } from 'bun:test';
import { createMessageSender } from '../services/message-sender';
import { createSentRegistry } from '../services/sent-registry';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';

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

function createMockClient(): BaileysClient {
  return {
    socket: null,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    sendMessage: mock(async (jid: string, content: any) => ({
      key: { id: `msg-${jid}-${Date.now()}` },
    })),
    sendPresenceUpdate: mock(async () => {}),
    presenceSubscribe: mock(async () => {}),
    getConnectionStatus: mock(() => 'connected' as const),
    getQr: mock(() => null),
    logout: mock(async () => {}),
    connect: mock(async () => {}),
    getContacts: mock(() => []),
    resyncContacts: mock(async () => ({ total: 0, inAddressBook: 0, addressBookSynced: true, skippedRecords: 0 })),
    readMessages: mock(async () => {}),
    uploadPreKeysToServerIfRequired: mock(async () => {}),
  };
}

describe('MessageSender', () => {
  it('sends text message and appends @s.whatsapp.net', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    const id = await sender.sendText('123456', 'Hello');

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { text: 'Hello' },
      undefined,
    );
    expect(id).toContain('msg-');
  });

  it('does not double-suffix jid when @ is present', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendText('123456@s.whatsapp.net', 'Hi');

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { text: 'Hi' },
      undefined,
    );
  });

  it('sends text with quoted reference (1:1)', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendText('555@s.whatsapp.net', 'Reply', { id: 'ORIG-1' });

    const call = (client.sendMessage as any).mock.calls.at(-1);
    expect(call[0]).toBe('555@s.whatsapp.net');
    expect(call[1]).toEqual({ text: 'Reply' });
    expect(call[2]).toEqual({
      quoted: {
        key: { remoteJid: '555@s.whatsapp.net', id: 'ORIG-1', fromMe: false },
        message: { conversation: '' },
      },
    });
  });

  it('sends text with quoted reference including participant and fromMe', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendText('group@g.us', 'Reply', {
      id: 'ORIG-2',
      participant: '999@s.whatsapp.net',
      fromMe: true,
    });

    const call = (client.sendMessage as any).mock.calls.at(-1);
    expect(call[2]).toEqual({
      quoted: {
        key: {
          remoteJid: 'group@g.us',
          id: 'ORIG-2',
          fromMe: true,
          participant: '999@s.whatsapp.net',
        },
        message: { conversation: '' },
      },
    });
  });

  it('sends image media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'image',
      url: 'https://example.com/img.jpg',
      caption: 'Look!',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { image: { url: 'https://example.com/img.jpg' }, caption: 'Look!', mimetype: undefined },
    );
  });

  it('sends video media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'video',
      url: 'https://example.com/vid.mp4',
      caption: 'Video!',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { video: { url: 'https://example.com/vid.mp4' }, caption: 'Video!', mimetype: undefined },
    );
  });

  it('sends document media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'document',
      url: 'https://example.com/doc.pdf',
      filename: 'doc.pdf',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { document: { url: 'https://example.com/doc.pdf' }, fileName: 'doc.pdf', caption: undefined, mimetype: undefined },
    );
  });

  it('sends audio media', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.sendMedia({
      to: '123456',
      type: 'audio',
      url: 'https://example.com/audio.ogg',
    });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { audio: { url: 'https://example.com/audio.ogg' }, mimetype: undefined },
    );
  });

  it('sends sticker with default webp mimetype', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);
    await sender.sendSticker('123456', 'https://example.com/s.webp');
    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { sticker: { url: 'https://example.com/s.webp' }, mimetype: 'image/webp' },
    );
  });

  it('sends location with name and address', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);
    await sender.sendLocation('123456', 19.4326, -99.1332, 'CDMX', 'Centro');
    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { location: { degreesLatitude: 19.4326, degreesLongitude: -99.1332, name: 'CDMX', address: 'Centro' } },
    );
  });

  it('sends location without optional fields', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);
    await sender.sendLocation('123456', 1, 2);
    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { location: { degreesLatitude: 1, degreesLongitude: 2 } },
    );
  });

  it('sends contact with vcard list', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);
    const vcards = [{ vcard: 'BEGIN:VCARD\nFN:Juan\nEND:VCARD' }];
    await sender.sendContact('123456', 'Juan', vcards);
    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { contacts: { displayName: 'Juan', contacts: vcards } },
    );
  });

  it('sends PTT with opus mimetype and ptt flag', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);
    await sender.sendPtt('123456', 'https://example.com/voice.ogg');
    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { audio: { url: 'https://example.com/voice.ogg' }, mimetype: 'audio/ogg; codecs=opus', ptt: true },
    );
  });

  it('throws for unsupported media type', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await expect(sender.sendMedia({
      to: '123456',
      type: 'unknown' as any,
      url: 'https://example.com/file',
    })).rejects.toThrow('Unsupported media type: unknown');
  });

  it('revokes own message with defaults (fromMe=true)', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.revoke('123456', 'MSG1');

    expect(client.sendMessage).toHaveBeenCalledWith(
      '123456@s.whatsapp.net',
      { delete: { remoteJid: '123456@s.whatsapp.net', id: 'MSG1', fromMe: true } },
    );
  });

  it('revokes a message in a group jid without re-normalizing', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.revoke('120000@g.us', 'MSG2');

    expect(client.sendMessage).toHaveBeenCalledWith(
      '120000@g.us',
      { delete: { remoteJid: '120000@g.us', id: 'MSG2', fromMe: true } },
    );
  });

  it('revokes a foreign message with fromMe=false and participant', async () => {
    const client = createMockClient();
    const sender = createMessageSender(client, createEventBus(), logger);

    await sender.revoke('120000@g.us', 'MSG3', { fromMe: false, participant: '52111@s.whatsapp.net' });

    expect(client.sendMessage).toHaveBeenCalledWith(
      '120000@g.us',
      { delete: { remoteJid: '120000@g.us', id: 'MSG3', fromMe: false, participant: '52111@s.whatsapp.net' } },
    );
  });

  it('propagates Baileys errors on revoke', async () => {
    const client = createMockClient();
    client.sendMessage = mock(async () => { throw new Error('nope'); });
    const sender = createMessageSender(client, createEventBus(), logger);

    await expect(sender.revoke('123456', 'MSG4')).rejects.toThrow('nope');
  });
  // ─── Registro de lo enviado ───────────────────────────────────────────────
  //
  // Es la mitad emisora de la costura que distingue el eco del consumidor del que escribe una
  // persona en el móvil. La otra mitad —el sellado— se prueba en session-manager.test.ts.

  describe('registro de lo enviado', () => {
    function clienteConId(id: string): BaileysClient {
      const client = createMockClient();
      client.sendMessage = mock(async (jid: string) => ({ key: { id, remoteJid: jid } })) as any;
      return client;
    }

    it('apunta la clave del mensaje de texto que acaba de salir', async () => {
      const registry = createSentRegistry({ ttlMs: 60_000, max: 100 });
      const sender = createMessageSender(clienteConId('MSG-A'), createEventBus(), logger, undefined, registry);

      await sender.sendText('123456', 'Hola');

      expect(registry.has('123456@s.whatsapp.net', 'MSG-A')).toBe(true);
    });

    it('apunta también los adjuntos', async () => {
      const registry = createSentRegistry({ ttlMs: 60_000, max: 100 });
      const sender = createMessageSender(clienteConId('MSG-B'), createEventBus(), logger, undefined, registry);

      await sender.sendMedia({ to: '123456', type: 'image', url: 'http://x/y.jpg' } as any);

      expect(registry.has('123456@s.whatsapp.net', 'MSG-B')).toBe(true);
    });

    it('apunta sin necesitar el cuerpo del mensaje', async () => {
      // La caché de reenvío sí lo exige, porque guarda el mensaje entero para reenviarlo;
      // el registro solo necesita la clave, y algunas respuestas de Baileys llegan sin
      // `message`. Confundir las dos condiciones dejaría ecos sin sellar.
      const registry = createSentRegistry({ ttlMs: 60_000, max: 100 });
      const client = createMockClient();
      client.sendMessage = mock(async () => ({
        key: { id: 'MSG-C', remoteJid: '123456@s.whatsapp.net' },
      })) as any;
      const sender = createMessageSender(client, createEventBus(), logger, undefined, registry);

      await sender.sendText('123456', 'Hola');

      expect(registry.has('123456@s.whatsapp.net', 'MSG-C')).toBe(true);
    });

    it('no revienta cuando no hay registro', async () => {
      const sender = createMessageSender(clienteConId('MSG-D'), createEventBus(), logger);

      await expect(sender.sendText('123456', 'Hola')).resolves.toBe('MSG-D');
    });

    it('una respuesta sin clave no apunta nada', async () => {
      const registry = createSentRegistry({ ttlMs: 60_000, max: 100 });
      const client = createMockClient();
      client.sendMessage = mock(async () => ({})) as any;
      const sender = createMessageSender(client, createEventBus(), logger, undefined, registry);

      await sender.sendText('123456', 'Hola');

      expect(registry.size()).toBe(0);
    });
  });
});
