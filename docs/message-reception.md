# Recepción de mensajes

WACore ofrece tres mecanismos para recibir mensajes entrantes de WhatsApp: SSE, webhook y polling. Puedes usar uno o varios simultáneamente.

> **Importante — `from` vs `phone`**: Cada mensaje incluye dos campos para identificar al remitente:
> - **`from`**: JID completo (ej: `5215512345678@s.whatsapp.net`). Úsalo **siempre** como valor de `to` al enviar una respuesta mediante `POST /api/send`.
> - **`phone`**: Solo el número (ej: `5215512345678`). Sirve para identificar contactos en tu UI o base de datos, **no** para responder.
>
> WACore resuelve internamente cualquier formato de JID (incluyendo LIDs de WhatsApp), por lo que `from` siempre contiene un JID de número telefónico válido al que se puede responder directamente.

## SSE (tiempo real)

Recomendado para servicios que necesitan recibir mensajes al instante. El servidor empuja los eventos al cliente a través de una conexión HTTP larga.

```javascript
// Ejemplo con JavaScript (Node.js, Bun, navegador)
const events = new EventSource(
  'http://localhost:9878/api/messages/stream?types=text,image',
  { headers: { Authorization: 'Bearer mi-api-key' } }
);

// El nombre del evento SSE es el `type` del mensaje: text, image, ptt, reaction...
events.addEventListener('text', (event) => {
  const msg = JSON.parse(event.data);
  console.log(`${msg.pushName}: ${msg.body}`);

  // Responder automáticamente
  if (msg.body === '!ping') {
    fetch('http://localhost:9878/api/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mi-api-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: msg.from, text: 'Pong!' }),
    });
  }
});
```

**Ventajas:**
- Tiempo real, sin polling.
- Bajo overhead (una conexión TCP persistente).
- Filtros del lado del servidor (`types`, `phone`, `includeGroups`).

Además de los mensajes, todos los streams reciben los eventos `presence`, `message.status` y `call` (llamadas, ver más abajo).

## Webhook

WACore hace un POST HTTP a una URL configurada por cada mensaje entrante. Ideal para integrar con servicios externos (n8n, Zapier, Make, tu propia API).

Configuración mínima:

```env
WEBHOOK_URL=https://mi-servicio.com/webhook/whatsapp
WEBHOOK_SECRET=mi-clave-hmac
WEBHOOK_EVENTS=message,connection,qr
```

> **Ediciones.** Cuando un cliente edita un mensaje, WACore recibe el texto nuevo con el `id` del
> mensaje **original**. Para que nadie lo tome por un mensaje nuevo, las ediciones no salen como
> `message`: solo se envían si `WEBHOOK_EVENTS` incluye `message.edit`, con `event: "message.edit"`
> y `data.isEdit: true`.

Valores aceptados en `WEBHOOK_EVENTS` (separados por coma):

| Valor | Evento(s) entregado(s) |
|---|---|
| `message` | `message`: mensajes entrantes (y ecos propios), salvo ediciones. |
| `message.edit` | `message.edit`: ediciones, con `data.isEdit: true` y el mismo `id` del mensaje original. |
| `connection` | `connection`: cambios de estado de la conexión. |
| `qr` | `qr`: nuevo código QR. |
| `media.downloaded` (o `media`) | `media.downloaded`: descarga de un archivo completada. |
| `presence` | `presence`: presencia de contactos suscritos. |
| `message.status` | `message.status`: acuses de envío, entrega y lectura. |
| `call` | `call`: llamadas entrantes. |
| `history` | `message.history` y `history.synced`: volcado de histórico al emparejar. |

### Tipos de mensaje

El campo `type` de un mensaje puede ser: `text`, `image`, `video`, `document`, `audio`, `ptt`
(nota de voz), `sticker`, `location`, `contact`, `reaction`, `order`, `product`, `event`,
`event_response` o `unknown`. Las notas de voz llegan como `ptt`, no como `audio`.

En los tipos estructurados (pedidos, productos, eventos de calendario, ubicaciones, contactos) los
datos relevantes van en `extras`. Las reacciones incluyen en `extras` el mensaje al que reaccionan:
`targetId`, `targetFromMe`, `targetRemoteJid` y `senderJid`.

Payload que recibe el webhook:

```json
{
  "event": "message",
  "instanceId": "bot-prod",
  "timestamp": "2025-05-08T12:00:00.000Z",
  "data": {
    "id": "3EB0C25E6A...",
    "from": "5215512345678@s.whatsapp.net",
    "phone": "5215512345678",
    "pushName": "Juan",
    "type": "text",
    "body": "Hola",
    "isGroup": false,
    ...
  }
}
```

Para mensajes multimedia, el campo `media` incluye metadatos del archivo:

```json
"media": {
  "mimetype": "image/jpeg",
  "caption": "Foto de prueba",
  "mediaId": "3EB0C25E6A...",
  "downloaded": true,
  "url": "/api/media/3EB0C25E6A..."
}
```

| Campo | Descripción |
|---|---|
| `mediaId` | ID del archivo para descargar via `GET /api/media/:mediaId`. |
| `downloaded` | `true` si el archivo ya fue descargado y está disponible. |
| `url` | Ruta relativa para descargar el archivo. |

### Evento `media.downloaded`

Si `WEBHOOK_EVENTS` incluye `media.downloaded`, se envía un webhook adicional cuando la descarga del archivo se completa:

```json
{
  "event": "media.downloaded",
  "instanceId": "bot-prod",
  "timestamp": "2025-05-08T12:00:05.000Z",
  "data": {
    "mediaId": "3EB0C25E6A...",
    "filePath": "/data/media/3EB0C25E6A....jpg",
    "extension": "jpg",
    "size": 102400,
    "messageId": "3EB0C25E6A..."
  }
}
```

### Evento `call`

Si `WEBHOOK_EVENTS` incluye `call`, cada llamada entrante genera varios eventos con el **mismo
`id`**, uno por cada cambio de estado (`offer` al sonar y después `accept`, `reject`, `timeout` o
`terminate`). Trátalos como actualizaciones de un mismo registro, no como llamadas distintas.

```json
{
  "event": "call",
  "instanceId": "bot-prod",
  "timestamp": "2025-05-08T12:00:00.000Z",
  "data": {
    "id": "5A1B2C3D...",
    "chatId": "5215512345678@s.whatsapp.net",
    "from": "5215512345678@s.whatsapp.net",
    "isGroup": false,
    "isVideo": false,
    "status": "offer",
    "timestamp": 1746705600,
    "offline": false
  }
}
```

### Eventos de histórico (`history`)

Al emparejar una línea, WhatsApp envía un volcado con conversaciones antiguas. Si `WEBHOOK_EVENTS`
incluye `history`, cada mensaje de ese volcado se entrega como `message.history` (mismo formato
que `message`) y al terminar se envía `history.synced` con `count` (mensajes emitidos) y `skipped`
(los que no cupieron en el tope). Estos mensajes **nunca** salen como `message`, para que un
consumidor no conteste a conversaciones de hace meses.

### Auto-download

Por defecto (`MEDIA_AUTO_DOWNLOAD=true`), WACore descarga automáticamente los archivos multimedia entrantes (imagen, video, audio, documento) en segundo plano. Los archivos se almacenan en `MEDIA_DIR` y se sirven via `GET /api/media/:id`.

Para deshabilitarlo:
```env
MEDIA_AUTO_DOWNLOAD=false
```

Headers adicionales:
- `X-WACore-Event: <event>`
- `X-WACore-Instance: bot-prod`
- `X-WACore-Timestamp: 2025-05-08T12:00:00.000Z`
- `X-WACore-Signature: <hmac-sha256>` (si se configuró `WEBHOOK_SECRET`)

> Incluye circuit breaker: tras fallos consecutivos, deja de intentar y se restablece automáticamente tras un tiempo de espera.

## Polling

Para sistemas simples que prefieren consultar mensajes bajo demanda.

```bash
# Cada N segundos, preguntar por mensajes nuevos
SINCE="2025-05-08T12:00:00Z"
while true; do
  RESP=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "http://localhost:9878/api/messages?since=$SINCE&limit=10")
  echo "$RESP" | jq -c '.data.messages[] | {from: .phone, body: .body}'
  SINCE=$(echo "$RESP" | jq -r '.data.cursor // $SINCE')
  sleep 3
done
```

Ver la sección [`GET /api/messages`](api-rest.md#get-apimessages--polling-de-mensajes-entrantes) para detalle del formato.
