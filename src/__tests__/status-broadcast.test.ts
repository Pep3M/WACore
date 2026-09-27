import { describe, expect, it } from 'bun:test';
import { esEstado, normalizeMessage } from '../core/normalize-message';

/** Los estados de los contactos no son mensajes de un chat y no se publican. */

describe('estados (status@broadcast)', () => {
  it('un estado con foto no se publica', () => {
    const n = normalizeMessage({
      key: { id: 'ST1', remoteJid: 'status@broadcast', participant: '5358174714@s.whatsapp.net', fromMe: false },
      messageTimestamp: 1_700_000_000,
      pushName: 'Pepe',
      message: { imageMessage: { mimetype: 'image/jpeg', caption: 'Ya te puedes crear una cuenta' } },
    });
    expect(n).toBeNull();
  });

  it('un mensaje de un chat sí', () => {
    const n = normalizeMessage({
      key: { id: 'M1', remoteJid: '5358174714@s.whatsapp.net', fromMe: false },
      messageTimestamp: 1_700_000_000,
      message: { conversation: 'hola' },
    });
    expect(n?.body).toBe('hola');
  });

  it('reconoce el jid de los estados', () => {
    expect(esEstado('status@broadcast')).toBe(true);
    expect(esEstado('5358174714@s.whatsapp.net')).toBe(false);
    expect(esEstado(null)).toBe(false);
  });
});
