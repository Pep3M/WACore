# API REST

Todas las peticiones requieren el header:

```
Authorization: Bearer <API_KEY>
```

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

> **Al responder a un mensaje recibido**: usa siempre el campo `from` (JID completo, ej: `5215512345678@s.whatsapp.net`), no el campo `phone`. WACore normaliza internamente cualquier formato de JID (incluyendo LIDs de WhatsApp), por lo que `from` siempre es un JID de número telefónico válido al que se puede responder directamente.

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

## `GET /api/status` — Estado de conexión

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/status
```

```json
{
  "success": true,
  "data": {
    "status": "connected",
    "connection": "connected",
    "phoneNumber": "5215512345678",
    "uptimeSeconds": 84321,
    "reconnections": 2
  }
}
```

Posibles valores de `status`: `connected`, `connecting`, `disconnected`, `awaiting-qr`, `logged-out`, `failed`.

## `GET /api/contacts` — Listar contactos

Devuelve los contactos conocidos (personas que han escrito al bot o están en la agenda de WhatsApp).

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/contacts
```

```json
{
  "success": true,
  "data": {
    "contacts": [
      {
        "phone": "5215512345678",
        "name": "Juan Pérez",
        "jid": "5215512345678@s.whatsapp.net"
      }
    ]
  }
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `phone` | string | Número telefónico sin sufijo. |
| `name` | string | Nombre del contacto (pushName o verifiedName). |
| `jid` | string | JID completo para usar en `POST /api/send`. |

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

> Requiere `POLLING_ENABLED=true`.

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
| `type` | string | Tipo de mensaje: `text`, `image`, `video`, `document`, `audio`, `reaction`. |
| `body` | string \| null | Contenido textual del mensaje (caption para multimedia, texto para reactions). |
| `quotedMessage` | object \| null | Mensaje citado al que responde (si aplica). |
| `media` | object \| null | Info del archivo multimedia (mimetype, filename, caption). |

## `GET /api/messages/stream` — SSE (Server-Sent Events)

> Habilitado por defecto (`SSE_ENABLED=true`).

```bash
curl -N -H "Authorization: Bearer $API_KEY" \
  "http://localhost:9878/api/messages/stream?types=text,image&includeGroups=true"
```

| Query param | Tipo | Default | Descripción |
|---|---|---|---|
| `types` | string (csv) | todos | Filtrar por tipo: `text`, `image`, `video`, `document`, `audio`, `reaction`. |
| `phone` | string | — | Filtrar por remitente (número sin sufijo `@s.whatsapp.net`). |
| `includeGroups` | boolean | `true` | Incluir mensajes de grupos. |

El stream envía eventos en este formato:

```
event: message.text
id: 3EB0C25E6A...
data: {"id":"3EB0C25E6A...","from":"5215512345678@s.whatsapp.net","phone":"5215512345678","type":"text","body":"Hola",...}

event: ping
data: {}
```

Eventos disponibles:
- `message.text`, `message.image`, `message.video`, `message.document`, `message.audio`, `message.reaction`
- `ping` — heartbeat cada 30s para mantener la conexión viva
