import type { RawMessageCache } from './raw-message-cache';
import type { ResolveMessage } from '../baileys/client';

/**
 * Le da a Baileys el contenido de un mensaje que esta línea envió.
 *
 * Baileys lo pide en dos momentos, y **sin esto los dos fallan sin decir nada**:
 *
 * 1. Cuando el teléfono del destinatario no consigue descifrar un mensaje y pide que se lo
 *    reenvíen. Sin el original no hay nada que reenviar: el consumidor da el mensaje por enviado y al
 *    cliente no le llega jamás.
 * 2. Cuando alguien contesta a una invitación de calendario o vota en una encuesta. Vienen
 *    **cifradas** con un secreto que vive dentro del mensaje original, así que sin él Baileys
 *    solo puede escribir «event creation message not found» y tirar la respuesta.
 *
 * **Devuelve el contenido, no el sobre.** El contrato de Baileys es
 * `getMessage: (key) => Promise<proto.IMessage | undefined>`, o sea el `message` de dentro.
 * Devolver el mensaje entero no da ningún error: Baileys busca dentro, no encuentra nada y sigue
 * como si no hubiera guardado nada. Es el fallo silencioso más fácil de cometer aquí.
 *
 * El alcance es el de la caché que se le pase: mientras el original siga ahí, funciona. Una
 * confirmación que llegue después de que caduque no se podrá leer, y eso no se puede arreglar
 * desde aquí — se arregla dándole una caché que dure más.
 */
export function createMessageResolver(cache: RawMessageCache): ResolveMessage {
  return async (key) => {
    const jid = key?.remoteJid;
    const id = key?.id;

    if (!jid || !id) return undefined;

    const guardado = cache.get(jid, id) as { message?: unknown } | undefined;

    return guardado?.message;
  };
}
