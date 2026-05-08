# WACore REST API

## Base URL

```
http://<host>:<API_PORT>/
```

`API_PORT` defaults to `9878`.

## Authentication

Todas las peticiones requieren el header `Authorization: Bearer <API_KEY>`.

```
Authorization: Bearer mi-api-key-segura
```

Si `API_KEY` no está definida en el entorno, el servidor REST se deshabilita.

---

## Endpoints

### `POST /api/send` — Enviar mensaje de texto

```json
{
  "to": "5215512345678",
  "text": "Hola, ¿cómo estás?"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `to` | string | sí | Número o JID de WhatsApp |
| `text` | string | sí | Contenido del mensaje |

**Response `200`:**

```json
{
  "success": true,
  "messageId": "3EB0C25E6A..."
}
```

---

### `POST /api/send-media` — Enviar multimedia

```json
{
  "to": "5215512345678",
  "type": "image",
  "url": "https://ejemplo.com/foto.jpg",
  "caption": "Mira esto",
  "mimetype": "image/jpeg",
  "filename": "foto.jpg"
}
```

| Campo | Tipo | Obligatorio | Descripción |
|-------|------|-------------|-------------|
| `to` | string | sí | Número o JID de WhatsApp |
| `type` | string | sí | `image`, `video`, `document` o `audio` |
| `url` | string | sí | URL pública del archivo |
| `caption` | string | no | Texto que acompaña al archivo |
| `mimetype` | string | no | Tipo MIME (detectado automáticamente si se omite) |
| `filename` | string | no | Nombre del archivo (solo `document`) |

**Response `200`:**

```json
{
  "success": true,
  "messageId": "3EB0C25E6A..."
}
```

**Response `400`:**

```json
{
  "success": false,
  "error": "Unsupported media type: gif"
}
```

---

### `GET /api/status` — Estado de conexión

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

Posibles valores de `status`: `connected`, `connecting`, `disconnected`, `qr`.

---

### `GET /api/qr` — Obtener QR en texto

```json
{
  "success": true,
  "data": {
    "qr": "1@abc123def456..."
  }
}
```

`qr` es `null` si no hay un QR activo.

---

### `DELETE /api/session` — Cerrar sesión

```json
{
  "success": true,
  "message": "Session closed"
}
```

Elimina las credenciales almacenadas y desconecta WhatsApp.

---

### `GET /api/messages` — Polling de mensajes entrantes

> Requiere `POLLING_ENABLED=true` (deshabilitado por defecto).

```
GET /api/messages?since=2025-05-08T12:00:00.000Z&limit=50
```

| Query param | Tipo | Default | Descripción |
|---|---|---|---|
| `since` | string (ISO 8601) | — | Solo mensajes posteriores a este timestamp |
| `limit` | number | `50` | Máximo de mensajes a devolver (máx. 200) |

**Response `200`:**

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
        "body": "Hola",
        "quotedMessage": null,
        "media": null
      }
    ],
    "cursor": "2025-05-08T12:00:00.000Z",
    "hasMore": false
  }
}
```

---

### `GET /api/messages/stream` — SSE (Server-Sent Events)

> Habilitado por defecto. Deshabilitar con `SSE_ENABLED=false`.

```
GET /api/messages/stream?types=text,image&phone=5215512345678&includeGroups=true
```

| Query param | Tipo | Default | Descripción |
|---|---|---|---|
| `types` | string (csv) | todos | Filtrar por tipo de mensaje: `text`,`image`,`video`,`document`,`audio`,`reaction` |
| `phone` | string | — | Filtrar por remitente (número sin sufijo) |
| `includeGroups` | boolean | `true` | Incluir mensajes de grupos |

El cliente recibe eventos SSE en tiempo real:

```
event: message.text
data: {"id":"3EB0C25E6A...","from":"5215512345678@s.whatsapp.net","phone":"5215512345678",...}

event: ping
data: {}
```

Heartbeat cada 30s (evento `ping`) para mantener la conexión viva.

---

## Variables de entorno relevantes

| Variable | Default | Descripción |
|----------|---------|-------------|
| `API_PORT` | `9878` | Puerto del servidor REST |
| `API_KEY` | — | Token para autenticación (si se omite, la API se deshabilita) |
| `POLLING_ENABLED` | `false` | Habilita `GET /api/messages` |
| `SSE_ENABLED` | `true` | Habilita `GET /api/messages/stream` |
| `MESSAGE_BUFFER_SIZE` | `1000` | Tamaño del buffer circular de mensajes |
| `MESSAGE_BUFFER_TTL_MS` | `300000` | TTL de mensajes en buffer (ms) |
| `SSE_HEARTBEAT_MS` | `30000` | Intervalo heartbeat SSE (ms) |

## Ejemplo con curl

```bash
API=http://localhost:9878
KEY=mi-api-key-segura

# Enviar texto
curl -X POST "$API/api/send" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","text":"Hola desde la API"}'

# Ver estado
curl -H "Authorization: Bearer $KEY" "$API/api/status"

# Cerrar sesión
curl -X DELETE -H "Authorization: Bearer $KEY" "$API/api/session"

# Polling de mensajes entrantes
curl -H "Authorization: Bearer $KEY" "$API/api/messages?since=2025-05-08T12:00:00Z&limit=10"

# SSE streaming (habilitado por defecto)
curl -N -H "Authorization: Bearer $KEY" "$API/api/messages/stream?types=text,image"
```
