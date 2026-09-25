# Variables de entorno

## Instancia

| Variable | Default | Descripción |
|---|---|---|
| `WA_INSTANCE_NAME` | `bot-dev` | Nombre único de la instancia. Determina la clave en DB o archivo de sesión. |
| `CONNECT_ON_STARTUP` | `true` | Conectar automáticamente al iniciar. Si `false`, espera a llamar a la API. |
| `LEGACY_SESSION_ENABLED` | `true` | Con `SESSION_STORE=postgres` y el registro de sesiones vacío (base nueva, o tras `DELETE /api/session` y un reinicio), crea la sesión `WA_INSTANCE_NAME`. Con `false` no se crea ninguna sesión automáticamente. |
| `QR_TIMEOUT` | `60000` | Tiempo máximo (ms) para escanear el QR antes de regenerarlo. |
| `QR_MAX_ROUNDS` | `3` | Rondas de QR que aguanta una sesión **sin emparejar** antes de rendirse y quedarse en `disconnected`. Una sesión ya emparejada reintenta siempre, sin tope. |

## API REST

| Variable | Default | Descripción |
|---|---|---|
| `API_PORT` | `9878` | Puerto del servidor REST. |
| `API_KEY` | — | Token para autenticar peticiones con Bearer API Key. **Si se omite, la API se deshabilita.** |
| `HEALTH_PORT` | `9877` | Puerto del health check (GET /health). |

## Logging

| Variable | Default | Descripción |
|---|---|---|
| `LOG_LEVEL` | `info` | Nivel de log: `debug`, `info`, `warn`, `error`. |

## Sesión (session store)

| Variable | Default | Descripción |
|---|---|---|
| `SESSION_STORE` | `file` | Backend de persistencia: `file`, `redis` o `postgres`. |
| `SESSION_DIR` | `/data/sessions` | Directorio para `file` store. |
| `DATABASE_URL` | — | URL de conexión para PostgreSQL (ej: `postgres://user:pass@host:5432/db`). Requerido si `SESSION_STORE=postgres`. |
| `REDIS_URL` | `redis://localhost:6379` | URL de conexión para Redis (requerido si `SESSION_STORE=redis`). |

## Mensajes entrantes

| Variable | Default | Descripción |
|---|---|---|
| `SSE_ENABLED` | `true` | Habilita `GET /api/messages/stream` (SSE en tiempo real). |
| `POLLING_ENABLED` | `true` | Habilita `GET /api/messages` (polling REST). `false` lo desactiva. |
| `MESSAGE_BUFFER_SIZE` | `1000` | Máximo de mensajes en buffer para polling/SSE. |
| `MESSAGE_BUFFER_TTL_MS` | `300000` | Tiempo de vida (ms) de mensajes en buffer (5 min). |
| `SSE_HEARTBEAT_MS` | `30000` | Intervalo (ms) del heartbeat SSE. |

## Forward cache

Raw `WAMessage` cacheados por sesión para `POST /api/forward` (necesarios porque baileys requiere el mensaje original completo al reenviar).

| Variable | Default | Descripción |
|---|---|---|
| `FORWARD_CACHE_MAX` | `5000` | Máximo de mensajes cacheados por sesión. |
| `FORWARD_CACHE_TTL_MS` | `86400000` | Tiempo de vida (ms) de cada entrada. 24 h por defecto. |

## Presence & Typing

| Variable | Default | Descripción |
|---|---|---|
| `AUTO_TYPING` | `true` | Mostrar "escribiendo..." automáticamente antes de responder. |
| `TYPING_DURATION_MS` | `3000` | Duración (ms) del indicador de typing antes de renovarse. |

## Media Download

| Variable | Default | Descripción |
|---|---|---|
| `MEDIA_DIR` | `/data/media` | Directorio donde se almacenan los archivos multimedia descargados. |
| `MEDIA_AUTO_DOWNLOAD` | `true` | Descargar automáticamente los medios entrantes (imagen, video, audio, documento). |
| `MEDIA_BASE_URL` | `http://localhost:9878` | URL base para generar enlaces de descarga de media (usado en respuestas de API). |

## Webhook

| Variable | Default | Descripción |
|---|---|---|
| `WEBHOOK_URL` | — | URL que recibe los mensajes via HTTP POST. Si se omite, webhook deshabilitado. |
| `WEBHOOK_SECRET` | — | Clave HMAC-SHA256 para firmar los payloads (header `X-WACore-Signature`). |
| `WEBHOOK_EVENTS` | `message` | Eventos a enviar: `message`, `message.edit`, `connection`, `qr`, `media.downloaded` (o `media`), `presence`, `message.status`, `call`, `history` (separados por coma). Las ediciones entrantes solo se envían con `message.edit`, como evento propio. Ver [`message-reception.md`](message-reception.md). |
| `WEBHOOK_RETRY_COUNT` | `3` | Número de reintentos ante fallo de entrega. |
| `WEBHOOK_RETRY_DELAY` | `5000` | Espera (ms) entre reintentos. |
