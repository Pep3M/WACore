# API REST

## Autenticación

Todas las rutas `/api/*` requieren la `API_KEY` configurada, de una de estas dos formas:

```
Authorization: Bearer <API_KEY>
```

o como query param `?api_key=<API_KEY>` (útil para `EventSource`, que no admite cabeceras).

## Sesión

WACore gestiona **una línea de WhatsApp por proceso**. Sin cabeceras extra, todas las rutas operan
sobre la sesión `WA_INSTANCE_NAME`. De forma opcional se puede indicar la sesión con la cabecera
`X-Session-Id: <id>`; si no existe, la ruta responde `404`.

## `GET /api/qr` — Obtener QR en texto

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/qr
```

```typescript
// Response
type QrResponse = {
  success: true;
  data: {
    /** Raw QR string (ej: "1@abc123def456..."). No es un enlace.
     *  Debe convertirse a imagen QR para escanearlo con WhatsApp. */
    qr: string;
  };
};

// Error — si ya hay conexión activa
type QrErrorResponse = {
  success: false;
  error: {
    code: "QR_NOT_AVAILABLE";
    message: "Ya hay una conexión activa, no hay QR disponible";
  };
};
```

```json
{
  "success": true,
  "data": { "qr": "1@abc123def456..." }
}
```

> Retorna `404` si ya hay una conexión activa (no hay QR disponible).

**Nota:** El string `qr` no es una URL ni un enlace. Es el contenido bruto que debe renderizarse como código QR. Para visualizarlo y escanearlo con WhatsApp puedes:

- **Desde el frontend (JS/TS):** usar una librería como [`qrcode`](https://www.npmjs.com/package/qrcode) para generar una imagen:
  ```ts
  import QRCode from 'qrcode';

  const res = await fetch('/api/qr', { headers: { Authorization } });
  const { data } = await res.json();
  const img = await QRCode.toDataURL(data.qr);
  // <img src={img} /> para mostrar en navegador
  ```
- **Desde terminal:** con `qrcode-terminal` o convirtiendo manualmente:
  ```bash
  curl -s -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/qr \
    | jq -r '.data.qr' | qrcode-terminal
  ```
- **Online:** pegar el string en generadores como [qrcodeserver.com](https://qrcodeserver.com) o [qr-code-generator.com](https://qr-code-generator.com).

## `POST /api/send` — Enviar mensaje de texto

```bash
curl -X POST http://localhost:9878/api/send \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","text":"Hola, ¿cómo estás?"}'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID de WhatsApp (con o sin `@s.whatsapp.net`). |
| `text` | string | sí | Contenido del mensaje. |
| `quotedMessageId` | string | no | ID del mensaje al que se responde (cita/reply). Si se envía, el mensaje aparecerá como respuesta al original en el cliente destino. |
| `quotedParticipant` | string | no | JID del autor del mensaje citado. Requerido en grupos para anclar la cita al autor correcto. En 1:1 puede omitirse. |
| `quotedFromMe` | boolean | no | `true` si el mensaje citado fue enviado por esta sesión. Default `false`. |

> **Al responder a un mensaje recibido**: usa siempre el campo `from` (JID completo, ej: `5215512345678@s.whatsapp.net`), no el campo `phone`. WACore normaliza internamente cualquier formato de JID (incluyendo LIDs de WhatsApp), por lo que `from` siempre es un JID de número telefónico válido al que se puede responder directamente.

**Ejemplo con cita (reply):**
```bash
curl -X POST http://localhost:9878/api/send \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to":"5215512345678@s.whatsapp.net",
    "text":"Respondiendo a tu mensaje",
    "quotedMessageId":"3EB0ABC123..."
  }'
```

En grupos, añade `quotedParticipant` con el JID del autor original:
```bash
  -d '{
    "to":"1203...@g.us",
    "text":"@respuesta",
    "quotedMessageId":"3EB0ABC123...",
    "quotedParticipant":"5215512345678@s.whatsapp.net"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": { "id": "3EB0C25E6A..." }
}
```

## `POST /api/send-media` — Enviar multimedia

```bash
curl -X POST http://localhost:9878/api/send-media \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","type":"image","url":"https://ejemplo.com/foto.jpg","caption":"Mira esto"}'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID de WhatsApp. |
| `type` | string | sí | `image`, `video`, `document` o `audio`. |
| `url` | string | sí | URL pública del archivo. |
| `caption` | string | no | Texto que acompaña al archivo. |
| `mimetype` | string | no | Tipo MIME (detectado automáticamente si se omite). |
| `filename` | string | no | Nombre del archivo (solo para `document`). |

## `POST /api/send-sticker` — Enviar sticker

```bash
curl -X POST http://localhost:9878/api/send-sticker \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","url":"https://ejemplo.com/sticker.webp"}'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID de WhatsApp. |
| `url` | string | sí | URL pública del archivo WebP. |
| `mimetype` | string | no | Por defecto `image/webp`. |

WhatsApp requiere formato **WebP 512×512** (idealmente < 100 KB). WACore no valida el archivo; si el WebP no cumple, WhatsApp lo mostrará como imagen o lo rechazará.

## `POST /api/send-location` — Enviar ubicación

```bash
curl -X POST http://localhost:9878/api/send-location \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","latitude":19.4326,"longitude":-99.1332,"name":"CDMX","address":"Centro"}'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID. |
| `latitude` | number | sí | Grados decimales (WGS84). |
| `longitude` | number | sí | Grados decimales (WGS84). |
| `name` | string | no | Nombre del lugar. |
| `address` | string | no | Dirección legible. |

## `POST /api/send-contact` — Enviar contacto (vCard)

```bash
curl -X POST http://localhost:9878/api/send-contact \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to":"5215512345678",
    "displayName":"Juan Pérez",
    "contacts":[
      {"vcard":"BEGIN:VCARD\nVERSION:3.0\nFN:Juan Pérez\nTEL;type=CELL;waid=5219999999999:+52 999 999 9999\nEND:VCARD"}
    ]
  }'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID. |
| `displayName` | string | sí | Nombre mostrado en el chat. |
| `contacts` | array | sí | Lista no vacía de `{vcard: string}` en formato RFC 5322. |

## `POST /api/send-ptt` — Enviar nota de voz (push-to-talk)

```bash
curl -X POST http://localhost:9878/api/send-ptt \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","url":"https://ejemplo.com/voz.ogg"}'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID. |
| `url` | string | sí | URL pública del audio. |
| `mimetype` | string | no | Por defecto `audio/ogg; codecs=opus`. |

WhatsApp muestra PTT con onda de audio cuando el codec es **OGG Opus**. Otros formatos aparecerán como archivos de audio genéricos.

## Recepción de estos tipos

Los mensajes entrantes se emiten en los eventos SSE / webhook / polling con `type` = `sticker`, `location`, `contact` o `ptt`. Para `location` y `contact` el payload incluye un campo `extras`:

- **location**: `{latitude, longitude, name?, address?}`
- **contact**: `{displayName, contacts: [{vcard}]}`
- **ptt**: `{ptt: true}`

## `GET /api/status` — Estado de conexión

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/status
```

```json
{
  "success": true,
  "data": {
    "status": "connected",
    "instance": "bot-prod",
    "connection": "connected",
    "phoneNumber": "5215512345678",
    "uptimeSeconds": 84321,
    "reconnections": 2
  }
}
```

Posibles valores de `status`: `connected`, `connecting`, `disconnected`, `awaiting-qr`, `logged-out`, `failed`.

## `GET /api/contacts` — Listar contactos

Devuelve la agenda **de la línea que pregunta**: los contactos guardados en su teléfono y quienes le
han escrito. Detalle completo, filtros y campos en [`contacts.md`](contacts.md).

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/contacts
```

```json
{
  "success": true,
  "data": {
    "contacts": [
      {
        "jid": "5215512345678@s.whatsapp.net",
        "phone": "5215512345678",
        "name": "Juan Pérez",
        "pushName": "Juan",
        "lid": null,
        "inAddressBook": true,
        "isMyContact": true
      }
    ],
    "total": 1,
    "limit": 100,
    "offset": 0
  }
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `phone` | string \| null | Dígitos del número. `null` si solo se conoce el LID. |
| `name` | string | Nombre de la agenda; si no hay, el verificado, el pushName o el número. |
| `jid` | string | JID canónico para usar en `POST /api/send`. |
| `inAddressBook` | boolean | Guardado en la agenda del teléfono de la línea. |

## `POST /api/contacts/resync` — Volver a pedir la agenda entera

Pide a WhatsApp la agenda completa de la línea y contesta cuando ya está guardada:
`{ "success": true, "data": { "total": 812, "inAddressBook": 640 } }`. `409` si la línea no está
conectada. Ver [`contacts.md`](contacts.md).

## `DELETE /api/session` — Cerrar sesión

```bash
curl -X DELETE -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/session
```

```json
{
  "success": true,
  "data": { "loggedOut": true }
}
```

Elimina las credenciales almacenadas y desconecta WhatsApp. Tras esto, WACore quedará desconectado. Para reconectar se requerirá escanear un nuevo QR.

## `POST /api/connect` — Forzar reconexión

Fuerza al cliente a reconectar con WhatsApp. Útil si la conexión se perdió y no se reconectó automáticamente, o si `CONNECT_ON_STARTUP=false`.

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/connect
```

```json
{
  "success": true,
  "data": { "connecting": true }
}
```

## `GET /api/messages` — Polling de mensajes entrantes

> Activo por defecto. Se desactiva con `POLLING_ENABLED=false`.

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "http://localhost:9878/api/messages?since=2025-05-08T12:00:00.000Z&limit=10"
```

| Query param | Tipo | Default | Descripción |
|---|---|---|---|
| `since` | string (ISO 8601) | — | Solo mensajes posteriores a este timestamp. Usa el `cursor` de la respuesta anterior para paginar. |
| `limit` | number | `50` | Máximo de mensajes (máx. 200). |

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "3EB0C25E6A...",
        "from": "5215512345678@s.whatsapp.net",
        "phone": "5215512345678",
        "pushName": "Juan",
        "isGroup": false,
        "groupId": null,
        "timestamp": 1747000000,
        "type": "text",
        "body": "Hola, cómo estás?",
        "quotedMessage": null,
        "media": null
      }
    ],
    "cursor": "2025-05-08T12:00:05.000Z",
    "hasMore": false
  }
}
```

**Campos de cada mensaje:**

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | string | ID único del mensaje en WhatsApp. |
| `from` | string | **JID completo** del remitente (ej: `5215512345678@s.whatsapp.net`). Úsalo siempre como `to` al responder por `POST /api/send`. |
| `phone` | string | Solo el número telefónico (ej: `5215512345678`). Sirve para identificar contactos o mostrar en UI. **No uses este campo para responder**, usa `from`. |
| `pushName` | string | Nombre que el contacto tiene configurado en WhatsApp. |
| `isGroup` | boolean | `true` si el mensaje proviene de un grupo. |
| `groupId` | string \| null | JID del grupo (solo si `isGroup` es `true`). |
| `timestamp` | number | Unix timestamp en segundos. |
| `type` | string | Tipo de mensaje: `text`, `image`, `video`, `document`, `audio`, `ptt`, `sticker`, `location`, `contact`, `reaction`, `order`, `product`, `event`, `event_response`, `unknown`. Las notas de voz llegan como `ptt`. |
| `body` | string \| null | Contenido textual del mensaje (caption para multimedia, texto para reactions). |
| `quotedMessage` | object \| null | Mensaje citado al que responde (si aplica). |
| `media` | object \| null | Info del archivo multimedia (mimetype, filename, caption, mediaId, downloaded, url). |
| `extras` | object | Datos estructurados según el tipo (pedido, producto, evento, ubicación, contacto...). En las reacciones: `targetId`, `targetFromMe`, `targetRemoteJid` y `senderJid`. |

## `DELETE /api/messages/:chatId/:messageId` — Eliminar mensaje (revoke)

Elimina un mensaje ("eliminar para todos") en el chat destino. Equivale a `socket.sendMessage(jid, { delete: key })` de Baileys.

- `chatId` — número o JID (`5215512345678`, `120000@g.us`, `5215512345678@s.whatsapp.net`). Si no contiene `@` se asume individual (`@s.whatsapp.net`).
- `messageId` — ID del mensaje en WhatsApp (el `id` que devolvió `POST /api/send` o el `id` de un mensaje entrante).

Body JSON opcional:

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `fromMe` | boolean | `true` | `true` para revocar mensajes que envió esta sesión. `false` para revocar mensajes ajenos (solo funciona si eres admin del grupo). |
| `participant` | string | — | JID del autor original del mensaje ajeno cuando `fromMe: false` en un grupo. |

```bash
# Revocar un mensaje propio
curl -X DELETE -H "Authorization: Bearer $API_KEY" \
  http://localhost:9878/api/messages/5215512345678/BAE5F0D9C1

# Revocar un mensaje ajeno en un grupo (siendo admin)
curl -X DELETE -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"fromMe":false,"participant":"5215500000000@s.whatsapp.net"}' \
  "http://localhost:9878/api/messages/120000%40g.us/BAE5F0D9C1"
```

```json
{
  "success": true,
  "data": { "revoked": true, "chatId": "5215512345678", "messageId": "BAE5F0D9C1" }
}
```

Si el mensaje ya no puede revocarse (fuera de la ventana permitida por WhatsApp, no eres admin, ID inexistente, etc.), la respuesta es `500` con el error propagado por Baileys.

## `POST /api/messages/:chatId/:messageId/reaction` — Reaccionar a un mensaje

Envía o retira una reacción emoji sobre un mensaje existente. Equivale a `socket.sendMessage(jid, { react: { text, key } })` de Baileys.

- `chatId` — número o JID (`5215512345678`, `120000@g.us`, `5215512345678@s.whatsapp.net`).
- `messageId` — ID del mensaje al que se reacciona.

Body JSON:

| Campo | Tipo | Default | Descripción |
|---|---|---|---|
| `emoji` | string | — | **Requerido.** Emoji a mostrar (`"👍"`, `"❤️"`, …). Enviar `""` retira la reacción previa. |
| `fromMe` | boolean | `true` | `true` si el mensaje original lo envió esta sesión. `false` para reaccionar a mensaje ajeno. |
| `participant` | string | — | JID del autor original cuando `fromMe: false` en un grupo. |

```bash
# Reaccionar a un mensaje propio
curl -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"emoji":"👍"}' \
  http://localhost:9878/api/messages/5215512345678/BAE5F0D9C1/reaction

# Reaccionar a un mensaje ajeno en un grupo
curl -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"emoji":"❤️","fromMe":false,"participant":"5215500000000@s.whatsapp.net"}' \
  "http://localhost:9878/api/messages/120000%40g.us/BAE5F0D9C1/reaction"

# Retirar la reacción
curl -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"emoji":""}' \
  http://localhost:9878/api/messages/5215512345678/BAE5F0D9C1/reaction
```

```json
{
  "success": true,
  "data": { "reacted": true, "chatId": "5215512345678", "messageId": "BAE5F0D9C1", "emoji": "👍" }
}
```

Si Baileys rechaza la reacción (mensaje inexistente, sesión desconectada, etc.), la respuesta es `500` con el error propagado.

## `POST /api/forward` — Reenviar un mensaje

Reenvía a uno o más destinos un mensaje que la sesión ya vio (recibido o enviado). Equivale a `socket.sendMessage(jid, { forward: msg })` de Baileys, que marca el mensaje resultante como reenviado (`contextInfo.isForwarded = true`).

El servidor mantiene un cache in-memory por sesión con los raw `WAMessage` de baileys (TTL `FORWARD_CACHE_TTL_MS`, capacidad `FORWARD_CACHE_MAX`). Si el `messageId` ya no está en el cache (expirado o desconocido) la respuesta es `404`.

Body JSON:

| Campo | Tipo | Descripción |
|---|---|---|
| `from` | string | JID del chat donde vive el mensaje original (`5215512345678@s.whatsapp.net`, `120000@g.us`). |
| `messageId` | string | ID del mensaje a reenviar. |
| `to` | string[] | Lista no vacía de JIDs destino. |

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "from":"5215512345678@s.whatsapp.net",
    "messageId":"BAE5F0D9C1",
    "to":["5215587654321@s.whatsapp.net","120000@g.us"]
  }' \
  http://localhost:9878/api/forward
```

Respuestas:

- **200** — todos los destinos OK.
  ```json
  {
    "success": true,
    "data": { "results": [
      { "to": "5215587654321@s.whatsapp.net", "id": "3EB0NEW1", "ok": true },
      { "to": "120000@g.us", "id": "3EB0NEW2", "ok": true }
    ] }
  }
  ```
- **207** — éxito parcial. `success: false`, cada `results[i]` indica su propio `ok`/`error`.
- **404** — el `messageId` no está en el cache para ningún destino: `{ "error": "source_message_not_found" }`.
- **400** — body inválido (falta `from`, `messageId` o `to` no es array no vacío de strings).
- **500** — error inesperado.

Cada reenvío exitoso emite internamente el evento `message.forwarded` por el EventBus (no se entrega por SSE ni webhook):

```json
{
  "from": "5215512345678@s.whatsapp.net",
  "sourceMessageId": "BAE5F0D9C1",
  "to": "5215587654321@s.whatsapp.net",
  "newMessageId": "3EB0NEW1",
  "timestamp": 1735689600000
}
```

## `GET /api/messages/stream` — SSE (Server-Sent Events)

> Habilitado por defecto (`SSE_ENABLED=true`).

```bash
curl -N -H "Authorization: Bearer $API_KEY" \
  "http://localhost:9878/api/messages/stream?types=text,image&includeGroups=true"
```

| Query param | Tipo | Default | Descripción |
|---|---|---|---|
| `types` | string (csv) | todos | Filtrar por tipo: `text`, `image`, `video`, `document`, `audio`, `ptt`, `sticker`, `location`, `contact`, `reaction`, `order`, `product`, `event`, `event_response`, `unknown`. |
| `phone` | string | — | Filtrar por remitente (número sin sufijo `@s.whatsapp.net`). |
| `includeGroups` | boolean | `true` | Incluir mensajes de grupos. |

El stream envía eventos en este formato:

```
event: text
id: 3EB0C25E6A...
data: {"id":"3EB0C25E6A...","from":"5215512345678@s.whatsapp.net","phone":"5215512345678","type":"text","body":"Hola",...}

event: ping
data: {}
```

Eventos disponibles:
- Un evento por mensaje, con el nombre de su `type` (`text`, `image`, `ptt`, `reaction`...)
- `presence` — cambios de estado del contacto (requiere suscribirse antes con `POST /api/presence/subscribe`)
- `message.status` — ACK de entrega/lectura de mensajes salientes (ver más abajo)
- `call` — llamadas entrantes; varios eventos con el mismo `id` por llamada (`offer`, `accept`, `reject`, `timeout`, `terminate`)
- `ping` — heartbeat cada 30s para mantener la conexión viva

### Evento `message.status` — ACK de mensajes salientes

WACore propaga los acuses de recibo de los mensajes que envía. Se emite un evento por cada cambio de estado del `key.id` del mensaje. Aparece como:

- SSE: `event: message.status`
- Webhook: `X-WACore-Event: message.status`

Payload:

```json
{
  "messageId": "3EB0ABC123",
  "status": 3,
  "statusLabel": "delivered",
  "chatJid": "5215512345678@s.whatsapp.net",
  "phone": "5215512345678",
  "isGroup": false,
  "fromMe": true,
  "timestamp": 1735689600000,
  "sessionId": "bot-prod"
}
```

`status` es el enum `WAMessageStatus` de WhatsApp:

| valor | label | significado |
|---|---|---|
| 0 | `error` | fallo al enviar |
| 1 | `pending` | pendiente en el cliente |
| 2 | `server-ack` | entregado al servidor WhatsApp |
| 3 | `delivered` | entregado al dispositivo destino |
| 4 | `read` | leído por el destinatario |
| 5 | `played` | audio/video reproducido |

Notas:
- El evento se emite solo para mensajes con `fromMe=true`.
- `phone` sólo se rellena para JIDs `@s.whatsapp.net`; en grupos y otros tipos vale `null`.
- Un mismo `messageId` puede recibir varios eventos (típicamente `2 → 3 → 4`). El consumidor debe idempotenciar por `(chatJid, messageId, status)`.
- En grupos WhatsApp emite el status agregado, no desglosado por participante.

## `POST /api/presence` — Enviar indicador de presencia/typing

```bash
curl -X POST http://localhost:9878/api/presence \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","type":"composing"}'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID de WhatsApp. |
| `type` | string | sí | `composing` (escribiendo), `recording` (grabando), `paused` (detenido), `available`, `unavailable`. |

> El bot también puede enviar `composing` automáticamente antes de cada respuesta si `AUTO_TYPING=true`.

## `POST /api/presence/subscribe` — Suscribirse al presence de un contacto

WhatsApp sólo envía actualizaciones de presence (`online`, `typing`, `recording`, `last seen`) para los JIDs que la sesión haya suscrito explícitamente. Llama a este endpoint una vez por chat que quieras monitorizar.

```bash
curl -X POST http://localhost:9878/api/presence/subscribe \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678"}'
```

| Campo | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `to` | string | sí | Número o JID (`@s.whatsapp.net` o `@g.us`). |

A partir de la suscripción, WACore emite eventos `presence` (SSE) y evento `presence` (webhook) con el siguiente payload:

```json
{
  "jid": "5215512345678@s.whatsapp.net",
  "isGroup": false,
  "participant": "5215512345678@s.whatsapp.net",
  "presence": "composing",
  "lastSeen": null,
  "timestamp": 1735689600000,
  "sessionId": "bot-prod"
}
```

`presence` puede valer `available`, `unavailable`, `composing`, `recording` o `paused`. En grupos se emite un evento por participante que cambia de estado.

## `GET /api/media/:id` — Descargar archivo multimedia

Sirve el archivo multimedia descargado previamente. Requiere que `MEDIA_AUTO_DOWNLOAD=true` (o que se haya descargado manualmente).

```bash
curl -H "Authorization: Bearer $API_KEY" \
  "http://localhost:9878/api/media/3EB0C25E6A..." --output foto.jpg
```

El `:id` corresponde al `mediaId` incluido en el campo `media` del mensaje normalizado.

## `GET /api/media` — Listar archivos multimedia disponibles

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/media
```

```json
{
  "success": true,
  "data": {
    "files": [
      {
        "mediaId": "3EB0C25E6A...",
        "url": "/api/media/3EB0C25E6A...",
        "exists": true
      }
    ]
  }
}
```

## Gestión de grupos

Todos los endpoints requieren autenticación (`Authorization: Bearer <API_KEY>`). La sesión se resuelve con la cabecera opcional `X-Session-Id`; sin ella se usa la sesión `WA_INSTANCE_NAME`.

Normalización de JIDs:
- Los IDs de grupo sin sufijo se completan con `@g.us`.
- Los IDs de participantes sin sufijo se completan con `@s.whatsapp.net`.

### `POST /api/groups` — Crear grupo

```bash
curl -X POST http://localhost:9878/api/groups \
  -H "Authorization: Bearer $API_KEY" \
  -H "X-Session-Id: default" \
  -H "Content-Type: application/json" \
  -d '{"subject":"Mi grupo","participants":["34600000001","34600000002"]}'
```

Response `200`: `{ "success": true, "data": <GroupMetadata> }`

### `GET /api/groups` — Listar grupos donde el bot participa

```bash
curl -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" http://localhost:9878/api/groups
```

Response: `{ "success": true, "data": { "groups": { "<jid>": <GroupMetadata>, ... } } }`

### `GET /api/groups/:jid` — Metadata del grupo

```bash
curl -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" \
  http://localhost:9878/api/groups/120363123456@g.us
```

### `PATCH /api/groups/:jid/subject` — Cambiar nombre

Body: `{ "subject": "Nuevo nombre" }`

### `PATCH /api/groups/:jid/description` — Cambiar descripción

Body: `{ "description": "Texto..." }` — omitir el campo o `null` limpia la descripción.

### `PATCH /api/groups/:jid/settings` — Cambiar ajustes

Body: `{ "setting": "announcement" | "not_announcement" | "locked" | "unlocked" }`

- `announcement` / `not_announcement`: sólo admins pueden enviar mensajes (o cualquiera).
- `locked` / `unlocked`: sólo admins pueden editar la info del grupo (o cualquiera).

### `POST /api/groups/:jid/participants` — Añadir/quitar/promover/degradar

Body: `{ "action": "add" | "remove" | "promote" | "demote", "participants": ["34600000003", ...] }`

Response: `{ "success": true, "data": { "results": [{ "status": "200", "jid": "..." }, ...] } }`

### `POST /api/groups/:jid/leave` — Salir del grupo

```bash
curl -X POST -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" \
  http://localhost:9878/api/groups/120363123456@g.us/leave
```

### `GET /api/groups/:jid/invite-code` — Obtener enlace de invitación

Response: `{ "success": true, "data": { "code": "ABC123...", "url": "https://chat.whatsapp.com/ABC123..." } }`

### `POST /api/groups/:jid/invite-code/revoke` — Revocar y regenerar el enlace

Response idéntico al anterior, con el nuevo `code`/`url`.

### `POST /api/groups/invite/accept` — Aceptar invitación por código

Body: `{ "code": "ABC123..." }` → `{ "success": true, "data": { "jid": "120363...@g.us" } }`

### `GET /api/groups/invite/:code` — Info previa a aceptar

Response: `{ "success": true, "data": <GroupMetadata> }`

## Gestión de perfil

Todos los endpoints bajo `/api/profile/*` requieren el header `Authorization: Bearer <API_KEY>` y resuelven la sesión igual que grupos (`X-Session-Id` opcional; sin ella, `WA_INSTANCE_NAME`). Los updates de perfil aplican al usuario autenticado en WhatsApp por la sesión resuelta.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/profile/me` | Perfil propio (jid, phone, name, status, picture) |
| GET | `/api/profile/:jid` | Perfil público de un contacto |
| GET | `/api/profile/:jid/picture` | URL de la foto (`?type=preview\|image`) |
| PATCH | `/api/profile/me/name` | Actualizar el nombre visible |
| PATCH | `/api/profile/me/status` | Actualizar el status ("about"). String vacío lo borra |
| PUT | `/api/profile/me/picture` | Actualizar foto (`imageUrl` **o** `imageData` base64) |
| DELETE | `/api/profile/me/picture` | Quitar foto |

### `GET /api/profile/me` — Perfil propio

```bash
curl -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" \
  http://localhost:9878/api/profile/me
```

Response:

```json
{
  "success": true,
  "data": {
    "jid": "5215500000000@s.whatsapp.net",
    "phone": "5215500000000",
    "name": "WACore Bot",
    "status": "available",
    "picture": "https://media.whatsapp.net/..."
  }
}
```

Cualquier campo que WhatsApp no exponga por privacidad viene como `null` (nunca error).

### `GET /api/profile/:jid` — Perfil de un contacto

`:jid` puede ir sin sufijo (se completa `@s.whatsapp.net`). Devuelve `null` en `picture`/`status`/`businessProfile` si la privacidad del contacto lo oculta.

Response:

```json
{
  "success": true,
  "data": {
    "jid": "34600000000@s.whatsapp.net",
    "exists": true,
    "picture": "https://media.whatsapp.net/...",
    "status": "busy",
    "businessProfile": null
  }
}
```

### `GET /api/profile/:jid/picture` — Foto de perfil

Query `type=preview` (thumbnail) o `type=image` (por defecto).

```bash
curl -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" \
  "http://localhost:9878/api/profile/34600000000/picture?type=image"
```

Response: `{ "success": true, "data": { "url": "https://media.whatsapp.net/..." | null } }`.

### `PATCH /api/profile/me/name`

Body: `{ "name": "WACore Bot" }`. Rechaza cadena vacía con 400.

### `PATCH /api/profile/me/status`

Body: `{ "status": "disponible" }`. Cadena vacía borra el status. El campo debe estar presente aunque sea `""`.

### `PUT /api/profile/me/picture`

Exactamente uno de:

- `{ "imageUrl": "https://example.com/pic.png" }` — WACore delega la descarga a Baileys.
- `{ "imageData": "data:image/png;base64,iVBORw0K..." }` o `{ "imageData": "<base64>" }` sin prefijo.

Límite: 5 MB tras decodificar. Excederlo devuelve `413`.

### `DELETE /api/profile/me/picture`

Quita la foto actual.

```bash
curl -X DELETE -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" \
  http://localhost:9878/api/profile/me/picture
```

## Etiquetas (labels — WhatsApp Business)

Las etiquetas se **importan pasivamente**: Baileys las entrega via eventos `labels.edit` (definición) y `labels.association` (asociación etiqueta ↔ chat/mensaje) durante el sync inicial y ante cada cambio en el móvil. WACore las persiste en `wacore_labels` / `wacore_label_associations` y las expone en modo lectura. Sólo funcionan con cuentas WhatsApp Business.

Baileys no expone crear/editar/borrar la etiqueta desde el gateway; esas operaciones se realizan desde la app WhatsApp Business.

> **Limitación conocida (WA Business "Listas")**: WhatsApp migró la feature de "Etiquetas" a "Listas" en muchas versiones/mercados durante 2024-2025. Las cuentas con la UI de "Listas" usan otra colección de app-state que Baileys aún no decodifica como label — en esas cuentas `GET /api/labels` devolverá `[]` aunque existan listas creadas en el móvil. La feature funciona en cuentas Business con la UI clásica de "Etiquetas". El día que Baileys añada soporte al nuevo protocolo, los endpoints se poblarán automáticamente sin cambios en WACore.

### `GET /api/labels` — Listar etiquetas

Query params:

- `includeDeleted=true` — incluye etiquetas marcadas como borradas (por defecto se omiten).

```bash
curl -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" \
  http://localhost:9878/api/labels
```

Response:

```json
{ "success": true, "data": { "labels": [
  { "id": "1", "name": "Cliente nuevo", "color": 0, "deleted": false, "predefinedId": "1" },
  { "id": "5", "name": "VIP", "color": 3, "deleted": false, "predefinedId": null }
]}}
```

### `GET /api/labels/:id/associations` — Chats/mensajes asociados

```bash
curl -H "Authorization: Bearer $API_KEY" -H "X-Session-Id: default" \
  http://localhost:9878/api/labels/1/associations
```

Response:

```json
{ "success": true, "data": {
  "chats": ["521555000000@s.whatsapp.net"],
  "messages": [{ "chatJid": "521555000000@s.whatsapp.net", "messageId": "3EB0..." }]
}}
```

Errores: `404` si la etiqueta no existe en el store para la sesión.

---

## Plantillas de mensajes (templates)

Plantillas locales por sesión con placeholders `{{var}}`. Se renderizan al enviar y se despachan como texto o media (image/video/document/audio) vía los canales estándar de Baileys.

> Las HSM oficiales de WhatsApp Business Cloud API **no** están soportadas — ver [`docs/templates.md`](templates.md) para el detalle de las limitaciones.

### `POST /api/templates` — Crear

```bash
curl -X POST -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"welcome","body":"Hola {{nombre}}, bienvenido a {{empresa}}."}' \
  http://localhost:9878/api/templates
```

Response `201`:

```json
{ "success": true, "data": {
  "id": "9f2d0…",
  "name": "welcome",
  "body": "Hola {{nombre}}, bienvenido a {{empresa}}.",
  "media": null,
  "createdAt": "2026-07-01T...",
  "updatedAt": "2026-07-01T..."
}}
```

Errores: `400` (name/body inválidos), `409` (nombre duplicado — case-insensitive).

### `GET /api/templates` — Listar

Devuelve `{ success, data: { templates: [...] } }` ordenado por `name`.

### `GET /api/templates/:id`

Devuelve la plantilla o `404`.

### `PUT /api/templates/:id` — Actualizar

Cuerpo parcial. `media: null` limpia la media, ausencia de la clave la conserva.

Errores: `400`, `404`, `409`.

### `DELETE /api/templates/:id`

`204` en éxito, `404` si no existe.

### `POST /api/templates/:id/send` — Renderizar y enviar

```bash
curl -X POST -H "x-api-key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"to":"'"$PHONE"'","variables":{"nombre":"Juan","empresa":"Acme"}}' \
  http://localhost:9878/api/templates/<ID>/send
```

Response:

```json
{ "success": true, "data": { "id": "<messageId>", "rendered": "Hola Juan, bienvenido a Acme." } }
```

Errores:
- `400 { error: "Missing variables", missing: ["empresa"] }` — falta alguna variable.
- `400` — `variables` no es objeto plano, `to` faltante, `quotedMessageId` combinado con media (no soportado en v1).
- `404` — plantilla no existe.
