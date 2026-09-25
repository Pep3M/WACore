import type { NormalizedMessage, MessageType, MessageOrigin } from '../types';

/**
 * De un mensaje crudo de Baileys al vocabulario que WACore publica.
 *
 * Vive aparte porque lo usan **dos** caminos: los mensajes que llegan en vivo y el volcado de
 * histórico al emparejar una línea. Dos normalizadores para lo mismo serían un fallo garantizado
 * —el histórico y lo nuevo acabarían con formas distintas en la misma conversación—, así que la
 * regla es que aquí no se copia nada: se importa.
 *
 * Es una función pura: ni bus de eventos, ni registro, ni red.
 */

export interface NormalizeOptions {
  /**
   * Dejar pasar los mensajes que salen de la línea.
   *
   * Cuando está apagado, un mensaje propio devuelve null y no llega a publicarse.
   */
  publishFromMe?: boolean;
}

/** @returns null si el mensaje no se puede o no se debe publicar */
export function normalizeMessage(raw: any, opts: NormalizeOptions = {}): NormalizedMessage | null {
  const fromMe = raw?.key?.fromMe === true;

  if (fromMe && opts.publishFromMe !== true) return null;

  // Una edición no llega como un mensaje más: viene envuelta en `protocolMessage`, con el
  // contenido nuevo dentro y la clave del mensaje **original**. Sin desenvolverla,
  // `detectMessageType` no reconoce nada y el mensaje se pierde en silencio — que es lo que
  // pasaba hasta ahora con cada texto que un cliente corregía desde su móvil.
  const fuente = desenvolverEdicion(raw) ?? raw;
  const esEdicion = fuente !== raw;

  const type = detectMessageType(fuente);
  if (!type) return null;

  const normalized: NormalizedMessage = {
    id: fuente.key?.id ?? '',
    from: fuente.key?.remoteJid ?? '',
    phone: extractPhone(fuente.key?.remoteJid ?? ''),
    // En un eco propio `pushName` es **nuestro** nombre, no el del interlocutor. Si viajara, el
    // consumidor lo tomaría por el nombre del contacto y machacaría el del cliente.
    pushName: fromMe ? '' : (raw.pushName ?? ''),
    isGroup: (fuente.key?.remoteJid ?? '').endsWith('@g.us'),
    groupId: (fuente.key?.remoteJid ?? '').endsWith('@g.us') ? fuente.key?.remoteJid ?? null : null,
    timestamp: extractTimestamp(fuente.messageTimestamp),
    type,
    body: extractBody(fuente, type),
    quotedMessage: extractQuoted(fuente),
    media: extractMedia(fuente, type, fuente.key?.id),
    sessionId: raw._sessionId ?? '',
    accountId: raw._accountId ?? null,
    userId: raw._userId ?? null,
    fromMe,
  };

  if (fromMe) {
    normalized.origin = extractOrigin(raw);

    // El acuse viaja con el eco a propósito: el mensaje puede llevar ya un rato entregado o
    // leído, y si el consumidor lo guardara como «recién enviado» el doble check azul bajaría
    // a un tick.
    const ack = extractAck(raw);
    if (ack !== null) normalized.ack = ack;
  }

  if (esEdicion) normalized.isEdit = true;

  const extras = extractExtras(fuente, type);
  if (extras) normalized.extras = extras;

  return normalized;
}

interface RespuestaInteractiva {
  kind: 'button' | 'list' | 'template' | 'native_flow';
  id: string | null;
  text: string | null;
}

/**
 * Lo que el cliente eligió al tocar un botón o una fila de una lista.
 *
 * Sin esto, la respuesta llegaba con `detectMessageType` a `null` y se descartaba entera: el
 * agente veía la pregunta con botones y **ninguna contestación**, como si el cliente no hubiera
 * respondido. Es el mismo agujero que tenían las ediciones.
 *
 * Se cubren las cuatro formas porque conviven según el cliente de WhatsApp que tenga enfrente,
 * y quedarse con una sola significa perder las respuestas de los demás.
 *
 * @returns null si no es una respuesta interactiva.
 */
function respuestaInteractiva(msg: any): RespuestaInteractiva | null {
  if (!msg) return null;

  const botones = msg.buttonsResponseMessage;
  if (botones) {
    return {
      kind: 'button',
      id: botones.selectedButtonId ?? null,
      text: botones.selectedDisplayText ?? null,
    };
  }

  const lista = msg.listResponseMessage;
  if (lista) {
    return {
      kind: 'list',
      id: lista.singleSelectReply?.selectedRowId ?? null,
      text: lista.title ?? null,
    };
  }

  const plantilla = msg.templateButtonReplyMessage;
  if (plantilla) {
    return {
      kind: 'template',
      id: plantilla.selectedId ?? null,
      text: plantilla.selectedDisplayText ?? null,
    };
  }

  const nativo = msg.interactiveResponseMessage;
  if (nativo) {
    // El formato nuevo mete la selección en un JSON dentro del mensaje. Si viene ilegible se
    // devuelve la respuesta igualmente, sin id: perder el texto de lo que contestó el cliente
    // por un JSON mal formado sería peor que quedarse sin el identificador.
    let id: string | null = null;
    const crudo = nativo.nativeFlowResponseMessage?.paramsJson;
    if (typeof crudo === 'string') {
      try {
        const datos = JSON.parse(crudo);
        id = datos?.id ?? datos?.selectedId ?? datos?.selected_id ?? null;
      } catch {
        id = null;
      }
    }
    return {
      kind: 'native_flow',
      id,
      text: nativo.body?.text ?? nativo.nativeFlowResponseMessage?.name ?? null,
    };
  }

  return null;
}

/** El valor del enum de Baileys para `ProtocolMessage.Type.MESSAGE_EDIT`. */
const PROTOCOL_MESSAGE_EDIT = 14;

/**
 * Desenvuelve una edición y la presenta como el mensaje original con el cuerpo nuevo.
 *
 * Devolver la clave **original** y no la del sobre es lo que hace útil al evento: permite al
 * consumidor localizar la burbuja que tiene guardada. Con el id nuevo solo podría añadir un
 * mensaje suelto con el texto corregido, sin forma de relacionarlo con nada.
 *
 * @returns null si no es una edición, para que el llamante siga por el camino normal.
 */
function desenvolverEdicion(raw: any): any | null {
  const protocolo = raw?.message?.protocolMessage;
  if (!protocolo) return null;

  // El tipo llega como número por el protocolo y como literal si alguien lo serializó por
  // el camino; se aceptan los dos antes que perder la edición por la forma del enum.
  const tipo = protocolo.type;
  if (tipo !== PROTOCOL_MESSAGE_EDIT && tipo !== 'MESSAGE_EDIT') return null;

  const contenido = protocolo.editedMessage;
  const idOriginal = protocolo.key?.id;
  if (!contenido || typeof idOriginal !== 'string' || idOriginal.length === 0) return null;

  return {
    ...raw,
    key: { ...(raw.key ?? {}), id: idOriginal },
    message: contenido,
  };
}

function detectMessageType(raw: any): MessageType | null {
  if (raw.message?.conversation) return 'text';
  if (raw.message?.extendedTextMessage) return 'text';
  // Lo que el cliente contesta tocando un botón o eligiendo de una lista es, para la
  // conversación, un mensaje de texto: lo que dijo. El identificador de la opción va en
  // `extras` para quien quiera ramificar por él, pero el cuerpo es la etiqueta visible, que
  // es lo que el agente tiene que leer en el chat.
  if (respuestaInteractiva(raw.message)) return 'text';
  if (raw.message?.imageMessage) return 'image';
  if (raw.message?.videoMessage) return 'video';
  if (raw.message?.documentMessage) return 'document';
  if (raw.message?.stickerMessage) return 'sticker';
  if (raw.message?.locationMessage) return 'location';
  if (raw.message?.contactMessage || raw.message?.contactsArrayMessage) return 'contact';
  if (raw.message?.audioMessage) return raw.message.audioMessage?.ptt ? 'ptt' : 'audio';
  if (raw.message?.reactionMessage) return 'reaction';
  // Comercio y calendario. Van al final a propósito: son los menos frecuentes y el orden de
  // este `if` en cadena es el orden en el que se paga el coste.
  if (raw.message?.orderMessage) return 'order';
  if (raw.message?.productMessage) return 'product';
  if (raw.message?.eventMessage) return 'event';
  return null;
}

/**
 * Los importes de WhatsApp vienen **multiplicados por mil**, no por cien.
 *
 * No es una convención que haya que suponer: todos los campos de dinero del protocolo se llaman
 * así —`totalAmount1000`, `priceAmount1000`, `salePriceAmount1000`, `paymentAmount1000`— y el
 * sufijo *es* la unidad. Se convierte aquí, una sola vez, para que ningún consumidor tenga que
 * acordarse.
 */
const MILESIMAS_POR_UNIDAD = 1000;

/** `number | Long | null` → number. Los importes grandes llegan como Long de protobuf. */
function aNumero(valor: unknown): number | null {
  if (typeof valor === 'number') return valor;
  if (typeof valor === 'string' && valor.trim() !== '' && !Number.isNaN(Number(valor))) return Number(valor);
  const maybeLong = valor as { toNumber?: () => number } | null | undefined;
  if (maybeLong && typeof maybeLong.toNumber === 'function') return maybeLong.toNumber();
  return null;
}

function aImporte(valor: unknown): number | null {
  const bruto = aNumero(valor);
  return bruto === null ? null : bruto / MILESIMAS_POR_UNIDAD;
}

function extractBody(raw: any, type: MessageType): string | null {
  const msg = raw.message ?? {};
  switch (type) {
    case 'text': {
      const interactiva = respuestaInteractiva(msg);
      return msg.conversation
        ?? msg.extendedTextMessage?.text
        ?? interactiva?.text
        ?? null;
    }
    case 'image': return msg.imageMessage?.caption ?? null;
    case 'video': return msg.videoMessage?.caption ?? null;
    case 'document': return msg.documentMessage?.caption ?? null;
    case 'reaction': return msg.reactionMessage?.text ?? null;
    case 'location': {
      const lat = msg.locationMessage?.degreesLatitude;
      const lng = msg.locationMessage?.degreesLongitude;
      return typeof lat === 'number' && typeof lng === 'number' ? `${lat},${lng}` : null;
    }
    case 'contact': return msg.contactMessage?.displayName ?? msg.contactsArrayMessage?.displayName ?? null;
    // Un pedido y una ficha de producto no traen texto: lo que se pinta en el chat es una
    // tarjeta. Se compone un cuerpo legible para que la conversación no muestre una burbuja
    // vacía y para que el buscador del consumidor encuentre algo; lo aprovechable va en `extras`.
    case 'order': {
      const orden = msg.orderMessage ?? {};
      const partes = [orden.orderTitle || 'Pedido recibido'];
      const items = aNumero(orden.itemCount);
      if (items !== null) partes.push(`${items} artículo(s)`);
      const total = aImporte(orden.totalAmount1000);
      if (total !== null) partes.push(`${total} ${orden.totalCurrencyCode ?? ''}`.trim());
      return partes.join(' · ');
    }
    case 'product': return msg.productMessage?.product?.title ?? null;
    case 'event': return msg.eventMessage?.name ?? null;
    default: return null;
  }
}

function extractExtras(raw: any, type: MessageType): Record<string, unknown> | null {
  const msg = raw.message ?? {};
  switch (type) {
    case 'location': {
      const loc = msg.locationMessage ?? {};
      const extras: Record<string, unknown> = {};
      if (typeof loc.degreesLatitude === 'number') extras.latitude = loc.degreesLatitude;
      if (typeof loc.degreesLongitude === 'number') extras.longitude = loc.degreesLongitude;
      if (loc.name) extras.name = loc.name;
      if (loc.address) extras.address = loc.address;
      return Object.keys(extras).length > 0 ? extras : null;
    }
    case 'contact': {
      if (msg.contactsArrayMessage) {
        return {
          displayName: msg.contactsArrayMessage.displayName ?? null,
          contacts: (msg.contactsArrayMessage.contacts ?? []).map((c: any) => ({ vcard: c?.vcard ?? '' })),
        };
      }
      if (msg.contactMessage) {
        return {
          displayName: msg.contactMessage.displayName ?? null,
          contacts: [{ vcard: msg.contactMessage.vcard ?? '' }],
        };
      }
      return null;
    }
    case 'ptt': return { ptt: true };
    case 'text': {
      const interactiva = respuestaInteractiva(msg);
      if (!interactiva) return null;
      return {
        selection: {
          kind: interactiva.kind,
          id: interactiva.id,
          text: interactiva.text,
        },
      };
    }
    /**
     * Una reacción sin decir a qué mensaje no sirve para nada.
     *
     * El emoji viajaba en `body` desde el principio y la clave del mensaje reaccionado se
     * descartaba, así que el consumidor recibía «alguien ha reaccionado 👍» sin poder saber a
     * qué. Aquí va solo lo que faltaba: el emoji sigue en `body`, que es donde vive, para no
     * tener el mismo dato en dos sitios.
     *
     * `text` vacío significa **reacción retirada**, no ausencia de reacción: es como WhatsApp
     * comunica que alguien ha quitado la suya.
     */
    case 'reaction': {
      const key = msg.reactionMessage?.key ?? {};

      if (!key.id) return null;

      return {
        targetId: key.id,
        targetFromMe: key.fromMe === true,
        targetRemoteJid: key.remoteJid ?? null,
        // Quién reacciona. En un grupo no es el interlocutor de la conversación, sino el
        // participante concreto; en un uno a uno `participant` no viene y vale el interlocutor.
        senderJid: raw.key?.participant ?? raw.key?.remoteJid ?? null,
      };
    }
    /**
     * Un pedido del catálogo.
     *
     * `orderId` y `token` son **perecederos** y son la única forma de pedirle a WhatsApp las
     * líneas del pedido (`GET /api/orders/:id?token=`). Van los dos aquí para que el consumidor
     * los guarde antes de encolar nada: si se dejan para el trabajo en diferido y el token
     * caduca, el pedido se queda sin detalle y no hay manera de recuperarlo.
     *
     * El total viaja ya dividido: WhatsApp lo manda en milésimas y dejarlo en crudo garantiza
     * que alguien acabe cobrando mil veces de más.
     */
    case 'order': {
      const orden = msg.orderMessage ?? {};
      const extras: Record<string, unknown> = {
        orderId: orden.orderId ?? null,
        token: orden.token ?? null,
        itemCount: aNumero(orden.itemCount),
        total: aImporte(orden.totalAmount1000),
        currency: orden.totalCurrencyCode ?? null,
        sellerJid: orden.sellerJid ?? null,
        title: orden.orderTitle ?? null,
        note: orden.message ?? null,
      };
      return extras;
    }
    /**
     * El cliente ha tocado un producto del catálogo para preguntar por él.
     *
     * Lo que lo hace valioso no es la tarjeta, es el `retailerId`: con él el consumidor sabe **de
     * qué producto** le están hablando y puede contestar sobre ese, en vez de saludar.
     */
    case 'product': {
      const p = msg.productMessage?.product ?? {};
      return {
        productId: p.productId ?? null,
        retailerId: p.retailerId ?? null,
        title: p.title ?? null,
        description: p.description ?? null,
        price: aImporte(p.priceAmount1000),
        salePrice: aImporte(p.salePriceAmount1000),
        currency: p.currencyCode ?? null,
        url: p.url ?? null,
        businessOwnerJid: msg.productMessage?.businessOwnerJid ?? null,
      };
    }
    /**
     * Una tarjeta de evento de calendario.
     *
     * Ojo con el nombre: en el protocolo el campo es **`isCanceled`** con una sola ele, aunque
     * las opciones de envío de Baileys lo llamen `isCancelled`. Escribir el de envío al leer
     * devuelve `undefined` y una cita cancelada pasa por vigente.
     */
    case 'event': {
      const ev = msg.eventMessage ?? {};
      const extras: Record<string, unknown> = {
        name: ev.name ?? null,
        description: ev.description ?? null,
        startTime: aNumero(ev.startTime),
        endTime: aNumero(ev.endTime),
        isCancelled: ev.isCanceled === true,
        joinLink: ev.joinLink ?? null,
        extraGuestsAllowed: ev.extraGuestsAllowed === true,
      };
      const loc = ev.location;
      if (loc) {
        extras.location = {
          latitude: typeof loc.degreesLatitude === 'number' ? loc.degreesLatitude : null,
          longitude: typeof loc.degreesLongitude === 'number' ? loc.degreesLongitude : null,
          name: loc.name ?? null,
          address: loc.address ?? null,
        };
      }
      return extras;
    }
    default: return null;
  }
}

function extractQuoted(raw: any): NormalizedMessage['quotedMessage'] {
  const context = raw.message?.extendedTextMessage?.contextInfo;
  if (!context?.quotedMessage) return null;
  return {
    id: context.stanzaId ?? '',
    from: context.participant ?? '',
    body: JSON.stringify(context.quotedMessage),
    type: 'text',
  };
}

function extractMedia(raw: any, type: MessageType, messageId?: string): NormalizedMessage['media'] {
  const msg = raw.message ?? {};
  const base = { mediaId: messageId, downloaded: false };
  switch (type) {
    case 'image': return { ...base, mimetype: msg.imageMessage?.mimetype ?? 'image/jpeg', caption: msg.imageMessage?.caption, filename: msg.imageMessage?.fileName };
    case 'video': return { ...base, mimetype: msg.videoMessage?.mimetype ?? 'video/mp4', caption: msg.videoMessage?.caption, filename: msg.videoMessage?.fileName };
    case 'document': return { ...base, mimetype: msg.documentMessage?.mimetype ?? 'application/octet-stream', filename: msg.documentMessage?.fileName, caption: msg.documentMessage?.caption };
    case 'audio': return { ...base, mimetype: msg.audioMessage?.mimetype ?? 'audio/ogg', filename: msg.audioMessage?.fileName };
    case 'ptt': return { ...base, mimetype: msg.audioMessage?.mimetype ?? 'audio/ogg; codecs=opus' };
    case 'sticker': return { ...base, mimetype: msg.stickerMessage?.mimetype ?? 'image/webp' };
    default: return null;
  }
}

/**
 * Quién escribió un mensaje propio.
 *
 * Lo sella el puente de la sesión comparando la clave contra el registro de lo que salió
 * por la API. Sin ese sello se asume `device`, que es la lectura prudente: procesar de más
 * un mensaje nuestro es recuperable; perder el que escribió una persona no.
 */
function extractOrigin(raw: any): MessageOrigin {
  return raw?._origin === 'api' ? 'api' : 'device';
}

/**
 * Acuse que WhatsApp ya trae en el mensaje.
 *
 * Baileys lo entrega en `status` con su escala (0 error … 5 reproducido). Solo se acepta
 * numérico: un valor con otra forma es peor que no mandar nada, porque el consumidor lo
 * guardaría como un acuse real.
 */
function extractAck(raw: any): number | null {
  const status = raw?.status;

  if (typeof status === 'number' && Number.isFinite(status)) {
    return status;
  }

  return null;
}

function extractPhone(jid: string): string {
  return jid.split('@')[0] ?? jid;
}

function extractTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (ts && typeof ts === 'object' && 'low' in ts) {
    const long = ts as { low: number; high: number };
    return long.low + long.high * 0x100000000;
  }
  return Math.floor(Date.now() / 1000);
}
