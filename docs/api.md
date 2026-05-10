# WACore

WACore es un backend para WhatsApp basado en [Baileys](https://github.com/whiskeysockets/baileys) (WebSocket, TypeScript). Permite conectar una instancia de WhatsApp, recibir mensajes entrantes en tiempo real y enviar mensajes mediante una API REST.

---

## Índice

- [Quick start](#quick-start)
- [Uso con Docker](#uso-con-docker)
- [Variables de entorno](#variables-de-entorno)
- [Conexión a WhatsApp](#conexión-a-whatsapp)
- [API REST](#api-rest)
  - [Obtener QR](#get-apiqr--obtener-qr-en-texto)
  - [Enviar mensaje de texto](#post-apisend--enviar-mensaje-de-texto)
  - [Enviar multimedia](#post-apisend-media--enviar-multimedia)
  - [Estado de conexión](#get-apistatus--estado-de-conexión)
  - [Cerrar sesión](#delete-apisession--cerrar-sesión)
  - [Polling de mensajes entrantes](#get-apimessages--polling-de-mensajes-entrantes)
  - [SSE streaming](#get-apimessagesstream--sse-server-sent-events)
- [Recepción de mensajes](#recepción-de-mensajes)
  - [SSE (tiempo real)](#sse-tiempo-real)
  - [Webhook](#webhook)
  - [Polling](#polling)
- [Persistencia de sesión](#persistencia-de-sesión)
- [Ejemplos de uso](#ejemplos-de-uso)
  - [Echo: responder con el mismo mensaje](#echo-responder-con-el-mismo-mensaje)
  - [Guardar contacto automáticamente](#guardar-contacto-automáticamente)
  - [Enviar mensaje desde otro servicio](#enviar-mensaje-desde-otro-servicio)

---

## Quick start

```bash
# 1. Clonar e instalar dependencias
git clone <repo> && cd WACore
bun install

# 2. Configurar (mínimo: API_KEY)
cp .env.example .env
# Editar .env y poner API_KEY=mi-clave-segura

# 3. Iniciar
bun start
```

En la terminal verás un código QR. Escanéalo con WhatsApp → **Ajustes > Dispositivos vinculados > Vincular un dispositivo**.

Una vez conectado, la API REST está disponible en `http://localhost:9878`.

---

## Uso con Docker

### Desde GitHub Container Registry

```bash
docker pull ghcr.io/pep3m/wacore:latest

docker run -d \
  --name wacore \
  -p 9877:9877 \
  -p 9878:9878 \
  -e API_KEY=mi-clave-segura \
  -e WA_INSTANCE_NAME=bot-prod \
  -v wa_sessions:/data/sessions \
  ghcr.io/pep3m/wacore:latest
```

### Con docker-compose (recomendado)

```yaml
# docker-compose.yml
services:
  wacore:
    image: ghcr.io/pep3m/wacore:latest
    container_name: wacore
    ports:
      - "9877:9877"   # Health check
      - "9878:9878"   # REST API
    volumes:
      - wa_sessions:/data/sessions
    environment:
      - WA_INSTANCE_NAME=bot-prod
      - API_KEY=mi-clave-segura
      - SESSION_STORE=postgres
      - DATABASE_URL=postgres://wacore:wacore@postgres:5432/wacore
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9877/health > /dev/null 2>&1 || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 3
      start_period: 10s

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: wacore
      POSTGRES_PASSWORD: wacore
      POSTGRES_DB: wacore
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wacore"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  wa_sessions:
  pg_data:
```

> **Nota**: Las migraciones de PostgreSQL se ejecutan automáticamente al arrancar. No necesitas correr nada manualmente.

---

## Variables de entorno

### Instancia

| Variable | Default | Descripción |
|---|---|---|
| `WA_INSTANCE_NAME` | `bot-dev` | Nombre único de la instancia. Determina la clave en DB o archivo de sesión. |
| `CONNECT_ON_STARTUP` | `true` | Conectar automáticamente al iniciar. Si `false`, espera a llamar a la API. |
| `QR_TIMEOUT` | `60000` | Tiempo máximo (ms) para escanear el QR antes de regenerarlo. |

### API REST

| Variable | Default | Descripción |
|---|---|---|
| `API_PORT` | `9878` | Puerto del servidor REST. |
| `API_KEY` | — | Token para autenticar peticiones. **Si se omite, la API se deshabilita.** |
| `HEALTH_PORT` | `9877` | Puerto del health check (GET /health). |

### Logging

| Variable | Default | Descripción |
|---|---|---|
| `LOG_LEVEL` | `info` | Nivel de log: `debug`, `info`, `warn`, `error`. |

### Sesión (session store)

| Variable | Default | Descripción |
|---|---|---|
| `SESSION_STORE` | `file` | Backend de persistencia: `file`, `redis` o `postgres`. |
| `SESSION_DIR` | `/data/sessions` | Directorio para `file` store. |
| `DATABASE_URL` | — | URL de conexión para PostgreSQL (ej: `postgres://user:pass@host:5432/db`). Requerido si `SESSION_STORE=postgres`. |
| `REDIS_URL` | `redis://localhost:6379` | URL de conexión para Redis (requerido si `SESSION_STORE=redis`). |

### Mensajes entrantes

| Variable | Default | Descripción |
|---|---|---|
| `SSE_ENABLED` | `true` | Habilita `GET /api/messages/stream` (SSE en tiempo real). |
| `POLLING_ENABLED` | `false` | Habilita `GET /api/messages` (polling REST). |
| `MESSAGE_BUFFER_SIZE` | `1000` | Máximo de mensajes en buffer para polling/SSE. |
| `MESSAGE_BUFFER_TTL_MS` | `300000` | Tiempo de vida (ms) de mensajes en buffer (5 min). |
| `SSE_HEARTBEAT_MS` | `30000` | Intervalo (ms) del heartbeat SSE. |

### Webhook

| Variable | Default | Descripción |
|---|---|---|
| `WEBHOOK_URL` | — | URL que recibe los mensajes via HTTP POST. Si se omite, webhook deshabilitado. |
| `WEBHOOK_SECRET` | — | Clave HMAC-SHA256 para firmar los payloads (header `X-WACore-Signature`). |
| `WEBHOOK_EVENTS` | `message` | Eventos a enviar: `message`, `connection`, `qr` (separados por coma). |
| `WEBHOOK_RETRY_COUNT` | `3` | Número de reintentos ante fallo de entrega. |
| `WEBHOOK_RETRY_DELAY` | `5000` | Espera (ms) entre reintentos. |

---

## Conexión a WhatsApp

### Primera conexión

Al iniciar WACore, si no hay una sesión guardada, se muestra un código QR en la terminal:

```
┌──────────────────────────────┐
│  ██ ██████ ██  ██  ██ ██████ │
│  ██  ██  ████ ██████ ██  ██ │
│  ████ ██████ ██████ ████████ │
│  ██████ ██████  ██  ██  ████ │
│  ██  ██████ ██████ ██████  ██ │
└──────────────────────────────┘
Escanea el QR con WhatsApp para conectar
```

**En WhatsApp**: Abre → Ajustes (⚙️) → Dispositivos vinculados → Vincular un dispositivo → Escanea el QR.

### Reconexión automática

WACore guarda la sesión automáticamente. Al reiniciar, si hay una sesión previa válida:

- **Con `SESSION_STORE=file`**: las credenciales persisten en `SESSION_DIR` (por defecto `/data/sessions/`).
- **Con `SESSION_STORE=redis`**: persisten en Redis.
- **Con `SESSION_STORE=postgres`**: persisten en PostgreSQL (tabla `wacore_sessions`).

No es necesario escanear el QR de nuevo a menos que la sesión expire o se cierre explícitamente con `DELETE /api/session`.

### Obtener QR via API

Si no se usó `CONNECT_ON_STARTUP=true` o se perdió la sesión:

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/qr
```

### Manejo del QR desde un frontend

El QR de WhatsApp **se regenera periódicamente** (~cada 20 segundos) hasta que el usuario lo escanea. Si el frontend se queda con el primer QR, este quedará obsoleto y el escaneo fallará.

**Flujo correcto:**

1. Consultar `GET /api/status` hasta que `status` sea `awaiting-qr`.
2. Iniciar un **polling cada 3-5 segundos** a `GET /api/qr` para obtener el QR vigente.
3. Renderizar el QR y permitir que el usuario lo escanee.
4. Cuando el usuario escanea, el status cambia a `connected`.
5. Detener el polling al salir del estado `awaiting-qr`.

```typescript
// Ejemplo: polling de QR en React
useEffect(() => {
  if (status !== 'awaiting-qr') {
    setQr(null);
    return;
  }
  const fetchQr = () =>
    fetch('/api/qr', { headers: { Authorization } })
      .then(r => r.json())
      .then(r => { if (r.success) setQr(r.data.qr); });
  fetchQr();
  const id = setInterval(fetchQr, 5000);
  return () => clearInterval(id);
}, [status]);
```

**Evento SSE `connection`:** el backend también notifica cambios de estado via SSE. Cuando el frontend recibe un evento `connection` con `status: "awaiting-qr"`, debe disparar el polling de QR. Al recibir `status: "connected"`, debe detenerlo y limpiar el QR.

---

## API REST

Todas las peticiones requieren el header:

```
Authorization: Bearer <API_KEY>
```

### `GET /api/qr` — Obtener QR en texto

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

### `POST /api/send` — Enviar mensaje de texto

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

**Response:**
```json
{
  "success": true,
  "data": { "id": "3EB0C25E6A..." }
}
```

### `POST /api/send-media` — Enviar multimedia

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

### `GET /api/status` — Estado de conexión

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

### `DELETE /api/session` — Cerrar sesión

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

### `GET /api/messages` — Polling de mensajes entrantes

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

### `GET /api/messages/stream` — SSE (Server-Sent Events)

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

---

## Recepción de mensajes

WACore ofrece tres mecanismos para recibir mensajes entrantes de WhatsApp. Puedes usar uno o varios simultáneamente.

### SSE (tiempo real)

Recomendado para servicios que necesitan recibir mensajes al instante. El servidor empuja los eventos al cliente a través de una conexión HTTP larga.

```javascript
// Ejemplo con JavaScript (Node.js, Bun, navegador)
const events = new EventSource(
  'http://localhost:9878/api/messages/stream?types=text,image',
  { headers: { Authorization: 'Bearer mi-api-key' } }
);

events.addEventListener('message.text', (event) => {
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

### Webhook

WACore hace un POST HTTP a una URL configurada por cada mensaje entrante. Ideal para integrar con servicios externos (n8n, Zapier, Make, tu propia API).

Configuración mínima:

```env
WEBHOOK_URL=https://mi-servicio.com/webhook/whatsapp
WEBHOOK_SECRET=mi-clave-hmac
WEBHOOK_EVENTS=message,connection,qr
```

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

Headers adicionales:
- `X-WACore-Event: message`
- `X-WACore-Instance: bot-prod`
- `X-WACore-Timestamp: 2025-05-08T12:00:00.000Z`
- `X-WACore-Signature: <hmac-sha256>` (si se configuró `WEBHOOK_SECRET`)

> Incluye circuit breaker: tras fallos consecutivos, deja de intentar y se restablece automáticamente tras un tiempo de espera.

### Polling

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

Ver la sección [`GET /api/messages`](#get-apimessages--polling-de-mensajes-entrantes) para detalle del formato.

---

## Persistencia de sesión

WACore guarda las credenciales de autenticación de WhatsApp para no requerir escanear el QR en cada reinicio. Soporta tres backends:

### File (default)

```env
SESSION_STORE=file
SESSION_DIR=/data/sessions
```

Guarda `creds.json` y `keys.json` en el directorio configurado. Incluye backups rotativos (`creds.json.bak.1`, `.bak.2`, `.bak.3`).

> ⚠️ En Docker, asegúrate de montar un volumen persistente en `SESSION_DIR` o perderás la sesión al recrear el contenedor.

### Redis

```env
SESSION_STORE=redis
REDIS_URL=redis://redis:6379
```

Las claves se almacenan como:
- `wacore:session:{instance}:creds`
- `wacore:session:{instance}:keys`

### PostgreSQL

```env
SESSION_STORE=postgres
DATABASE_URL=postgres://user:pass@host:5432/db
```

Las migraciones se ejecutan **automáticamente** al arrancar. No necesitas correr nada manual.

Esquema de la tabla (`wacore_sessions`):

```sql
CREATE TABLE IF NOT EXISTS wacore_sessions (
    instance_name TEXT PRIMARY KEY,
    creds         JSONB NOT NULL,
    keys          JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> Múltiples instancias de WACore (distinto `WA_INSTANCE_NAME`) pueden compartir la misma base de datos PostgreSQL sin conflictos.

---

## Ejemplos de uso

### Echo: responder con el mismo mensaje

Usando SSE + REST API desde un script externo:

```javascript
// echo.js — recibe mensajes y responde con eco
const API = 'http://localhost:9878';
const KEY = 'mi-api-key';

async function main() {
  const response = await fetch(`${API}/api/messages/stream?types=text`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('ping')) {
        const msg = JSON.parse(line.slice(6));

        // Responder con el mismo mensaje (eco)
        await fetch(`${API}/api/send`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: msg.from,
            text: `Echo: ${msg.body || '(sin texto)'}`,
          }),
        });

        console.log(`Respondido a ${msg.pushName}: ${msg.body}`);
      }
    }
  }
}

main().catch(console.error);
```

```bash
bun run echo.js
```

### Guardar contacto automáticamente

Cuando alguien escribe por primera vez, se registra su número:

```javascript
// contacts.js
const API = 'http://localhost:9878';
const KEY = 'mi-api-key';
const seen = new Set();

async function main() {
  const response = await fetch(`${API}/api/messages/stream?types=text,image`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('ping')) {
        const msg = JSON.parse(line.slice(6));

        if (!seen.has(msg.phone) && !msg.isGroup) {
          seen.add(msg.phone);
          console.log(`Nuevo contacto: ${msg.pushName} (${msg.phone})`);
          // Aquí podrías guardar en tu propia base de datos
        }
      }
    }
  }
}

main().catch(console.error);
```

### Enviar mensaje desde otro servicio

```python
import requests

API = "http://localhost:9878"
KEY = "mi-api-key"

# Enviar texto
resp = requests.post(
    f"{API}/api/send",
    headers={"Authorization": f"Bearer {KEY}"},
    json={"to": "5215512345678", "text": "Hola desde Python"}
)
print(resp.json())

# Verificar estado
status = requests.get(
    f"{API}/api/status",
    headers={"Authorization": f"Bearer {KEY}"}
)
print(status.json()["data"])
```

---

## Health check

```
GET /health
```

```json
{
  "status": "healthy",
  "connection": "connected",
  "phoneNumber": "5215512345678",
  "uptimeSeconds": 84321,
  "reconnections": 2
}
```

Este endpoint **no requiere autenticación**. Está diseñado para orquestadores (Kubernetes, Docker Swarm, etc.). Corre en el puerto `HEALTH_PORT` (default `9877`), separado de la API REST.
