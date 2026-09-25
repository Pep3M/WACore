import { describe, expect, it } from 'bun:test';
import { normalizeMessage } from '../core/normalize-message';

/**
 * Una reacción tiene que decir a qué mensaje pertenece.
 *
 * El emoji viajaba desde el principio; la clave del mensaje reaccionado se descartaba en la
 * normalización, así que el consumidor recibía «alguien ha reaccionado 👍» y no podía saber a
 * qué. Con eso, una reacción entrante no se puede pintar ni guardar: es un evento inútil.
 */

function rawReaction(overrides: Record<string, any> = {}): any {
  return {
    key: { remoteJid: '34600111222@s.whatsapp.net', id: 'REACTION-1', fromMe: false },
    message: {
      reactionMessage: {
        key: { remoteJid: '34600111222@s.whatsapp.net', id: 'TARGET-1', fromMe: true },
        text: '👍',
      },
    },
    messageTimestamp: 1000000,
    _sessionId: 'acc:1',
    ...overrides,
  };
}

describe('normalizeMessage · reacciones', () => {
  it('dice a qué mensaje pertenece la reacción', () => {
    const normalized = normalizeMessage(rawReaction());

    expect(normalized?.type).toBe('reaction');
    expect(normalized?.extras).toMatchObject({
      targetId: 'TARGET-1',
      targetFromMe: true,
      targetRemoteJid: '34600111222@s.whatsapp.net',
    });
  });

  /** El emoji vive en `body` desde siempre. Duplicarlo en `extras` sería tener el mismo dato en dos sitios. */
  it('el emoji sigue viajando en el cuerpo', () => {
    expect(normalizeMessage(rawReaction())?.body).toBe('👍');
  });

  /**
   * Un texto vacío significa **reacción retirada**, no ausencia de reacción: es como WhatsApp
   * comunica que alguien ha quitado la suya. Tratarlo como «sin reacción» dejaría el emoji
   * pegado en la conversación para siempre.
   */
  it('una reacción retirada llega con el cuerpo vacío y su objetivo', () => {
    const raw = rawReaction();
    raw.message.reactionMessage.text = '';

    const normalized = normalizeMessage(raw);

    expect(normalized?.body).toBe('');
    expect(normalized?.extras?.targetId).toBe('TARGET-1');
  });

  /** En un grupo quien reacciona no es el interlocutor de la conversación. */
  it('en un grupo identifica al participante que reacciona', () => {
    const normalized = normalizeMessage(rawReaction({
      key: {
        remoteJid: '120363400391446350@g.us',
        id: 'REACTION-1',
        fromMe: false,
        participant: '34600999888@s.whatsapp.net',
      },
    }));

    expect(normalized?.extras?.senderJid).toBe('34600999888@s.whatsapp.net');
  });

  /** En un uno a uno no viene `participant`: quien reacciona es el interlocutor. */
  it('en un uno a uno quien reacciona es el interlocutor', () => {
    expect(normalizeMessage(rawReaction())?.extras?.senderJid).toBe('34600111222@s.whatsapp.net');
  });

  /**
   * Sin clave de objetivo no hay nada que publicar. Antes que emitir una reacción huérfana
   * —que el consumidor no puede colocar en ningún sitio— se descarta la parte que sobra.
   */
  it('sin clave de objetivo no inventa extras', () => {
    const raw = rawReaction();
    delete raw.message.reactionMessage.key;

    expect(normalizeMessage(raw)?.extras).toBeUndefined();
  });

  /** Una reacción propia solo se publica si los mensajes propios están activados. */
  it('una reacción propia respeta la bandera de mensajes propios', () => {
    const propia = rawReaction({
      key: { remoteJid: '34600111222@s.whatsapp.net', id: 'REACTION-1', fromMe: true },
    });

    expect(normalizeMessage(propia)).toBeNull();
    expect(normalizeMessage(propia, { publishFromMe: true })?.extras?.targetId).toBe('TARGET-1');
  });
});
