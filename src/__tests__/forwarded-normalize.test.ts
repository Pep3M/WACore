import { describe, expect, it } from 'bun:test';
import { normalizeMessage } from '../core/normalize-message';

/** Reenvíos: el consumidor necesita saber que el remitente no escribió el mensaje. */

function sobre(message: Record<string, unknown>) {
  return {
    key: { id: 'MSG1', remoteJid: '34600111222@s.whatsapp.net', fromMe: false },
    messageTimestamp: 1_700_000_000,
    pushName: 'Cliente',
    message,
  };
}

describe('mensajes reenviados', () => {
  it('un texto reenviado viaja con isForwarded y su forwardingScore', () => {
    const n = normalizeMessage(sobre({
      extendedTextMessage: { text: 'Sigue el canal de Estética Yi', contextInfo: { isForwarded: true, forwardingScore: 6 } },
    }));
    expect(n?.isForwarded).toBe(true);
    expect(n?.forwardingScore).toBe(6);
    expect(n?.body).toBe('Sigue el canal de Estética Yi');
  });

  it('una foto reenviada también', () => {
    const n = normalizeMessage(sobre({
      imageMessage: { mimetype: 'image/jpeg', caption: 'Paquito felíz', contextInfo: { isForwarded: true } },
    }));
    expect(n?.isForwarded).toBe(true);
    expect(n?.forwardingScore).toBe(1);
  });

  it('un mensaje propio del remitente no lleva los campos', () => {
    const texto = normalizeMessage(sobre({ conversation: 'hola, tienen ollas?' }));
    const cita = normalizeMessage(sobre({
      extendedTextMessage: { text: 'esta', contextInfo: { stanzaId: 'X', quotedMessage: { conversation: 'Olla' } } },
    }));
    for (const n of [texto, cita]) {
      expect(n?.isForwarded).toBeUndefined();
      expect(n?.forwardingScore).toBeUndefined();
    }
  });
});
