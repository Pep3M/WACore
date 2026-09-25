import { describe, expect, it, mock } from 'bun:test';
import { createMessageResolver } from '../services/message-resolver';
import { createRawMessageCache } from '../services/raw-message-cache';

/**
 * El enganche que le da a Baileys el original de un mensaje que mandamos.
 *
 * No tiene ninguna pantalla y no se nota cuando funciona; se nota cuando falta, y en dos formas
 * igual de mudas: mensajes que el cliente nunca recibe pese a constar como enviados, y
 * confirmaciones de cita que llegan y no se pueden descifrar. WACore no lo tenía.
 */
describe('resolver el original de un mensaje enviado', () => {
  const conMensaje = () => {
    const cache = createRawMessageCache({ ttlMs: 60_000, max: 10 });
    cache.put({
      key: { id: 'MSG1', remoteJid: '34600111222@s.whatsapp.net', fromMe: true },
      message: { conversation: 'Hola', messageContextInfo: { messageSecret: 'secreto' } },
    } as any);
    return cache;
  };

  /**
   * La regla que sostiene todo lo demás. El contrato de Baileys es
   * `getMessage: (key) => Promise<proto.IMessage | undefined>`: el **contenido**, no el sobre.
   * Devolver el mensaje entero no da error — Baileys mira dentro, no encuentra nada y se calla.
   */
  it('devuelve el contenido, no el sobre', async () => {
    const resolver = createMessageResolver(conMensaje());

    const r = await resolver({ id: 'MSG1', remoteJid: '34600111222@s.whatsapp.net' }) as any;

    expect(r?.conversation).toBe('Hola');
    // Y sobre todo: el secreto con el que se descifran las confirmaciones tiene que llegar.
    expect(r?.messageContextInfo?.messageSecret).toBe('secreto');
    expect(r?.key).toBeUndefined();
  });

  it('un mensaje que ya no está devuelve undefined, no revienta', async () => {
    const resolver = createMessageResolver(conMensaje());

    expect(await resolver({ id: 'OTRO', remoteJid: '34600111222@s.whatsapp.net' })).toBeUndefined();
  });

  /**
   * Se comprueba que **no se consulta**, no solo que devuelve `undefined`: la caché ya devuelve
   * `undefined` ante una clave a medias, así que afirmar solo eso deja pasar un resolver sin
   * guarda ninguna. Baileys llama a esto en el camino de recepción de cada acuse.
   */
  it('una clave incompleta ni siquiera llega a consultar la caché', async () => {
    const get = mock(() => undefined);
    const resolver = createMessageResolver({ get, put: () => {}, size: () => 0, clear: () => {} } as any);

    expect(await resolver({ id: 'MSG1' })).toBeUndefined();
    expect(await resolver({ remoteJid: '34600111222@s.whatsapp.net' })).toBeUndefined();
    expect(await resolver({})).toBeUndefined();

    expect(get).not.toHaveBeenCalled();
  });
});
