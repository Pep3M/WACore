<div align="center">

<img src=".github/assets/banner.png" alt="WACore: tu propia API de WhatsApp, a un escaneo de QR" width="100%">

<br>

[![Tests](https://github.com/Pep3M/WACore/actions/workflows/ci.yml/badge.svg)](https://github.com/Pep3M/WACore/actions/workflows/ci.yml)
[![Docker image](https://github.com/Pep3M/WACore/actions/workflows/docker-build.yml/badge.svg)](https://github.com/Pep3M/WACore/pkgs/container/wacore)
[![Release](https://img.shields.io/github/v/tag/Pep3M/WACore?label=release&color=25d366&sort=semver)](CHANGELOG.md)
[![Bun](https://img.shields.io/badge/runtime-Bun%201.4-fbf0df?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**API HTTP de WhatsApp autoalojada, pensada para desarrolladores.**<br>
Escaneas un QR una vez, envías mensajes con una llamada REST y los recibes por webhook, SSE o polling.

[Empezar](#-empezar) · [Cómo funciona](#-cómo-funciona) · [API](#-la-api-de-un-vistazo) · [Docs](docs/index.md) · [English](README.md)

</div>

---

## Por qué WACore

Quieres que tu aplicación hable por WhatsApp sin depender de un SaaS, sin pagar por mensaje y sin mantener vivo un Chrome headless. WACore corre junto a tu código, se vincula a tu número igual que WhatsApp Web y te da una API HTTP pequeña y predecible.

- **Sin navegador.** Habla el protocolo de WhatsApp Web por WebSocket mediante [Baileys](https://github.com/WhiskeySockets/Baileys), sin Puppeteer ni Chromium. En reposo gasta una fracción de la memoria que necesita un navegador.
- **Cualquier lenguaje.** Si tu stack puede hacer una petición HTTP, puede enviar mensajes de WhatsApp. Los entrantes te llegan como prefieras: webhook firmado, stream SSE en vivo o polling.
- **Hecho para no caerse.** Reconexión con backoff exponencial, sesión persistente entre reinicios (File, Redis o PostgreSQL), recuperación sola tras cortes de red largos y un puerto `/health` aparte para tu orquestador.
- **Payloads predecibles.** Cada mensaje entrante se normaliza a una única forma tipada. Los LID internos de WhatsApp se resuelven a JID de teléfono, así que siempre puedes responder a `from`.
- **Contrato con tests.** Más de 770 tests, incluidos tests de contrato que fijan las rutas públicas, la autenticación y la forma de los payloads entre versiones.

## ⚡ Empezar

### 1. Arráncalo

**Con Docker** (recomendado):

```bash
docker run -d --name wacore \
  -p 9877:9877 -p 9878:9878 \
  -e API_KEY=cambia-esto \
  -e SESSION_STORE=file \
  -v wacore_data:/data \
  ghcr.io/pep3m/wacore:latest
```

**O desde el código**, con [Bun](https://bun.sh) ≥ 1.4.2:

```bash
git clone https://github.com/Pep3M/WACore.git && cd WACore
bun install
cp .env.example .env          # pon API_KEY=cambia-esto
bun start
```

### 2. Vincula tu número

El QR sale en los logs (`docker logs -f wacore`). En el móvil, abre **WhatsApp → Ajustes → Dispositivos vinculados → Vincular un dispositivo** y escanéalo. La sesión se guarda, así que solo lo haces una vez.

> También puedes pedir el QR como texto a `GET /api/qr` y pintarlo en tu propia interfaz.

### 3. Envía tu primer mensaje

```bash
curl -X POST http://localhost:9878/api/send \
  -H "Authorization: Bearer cambia-esto" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","text":"Hola desde WACore 👋"}'
```

```json
{ "success": true, "data": { "id": "3EB0C25E6A9F..." } }
```

### 4. Recibe mensajes

Dale a WACore la URL de tu endpoint y cada mensaje entrante te llegará como un `POST` firmado:

```bash
-e WEBHOOK_URL=https://tu-app.com/whatsapp \
-e WEBHOOK_SECRET=una-cadena-larga-y-aleatoria
```

```json
{
  "event": "message",
  "instanceId": "default",
  "timestamp": "2026-09-27T12:00:00.000Z",
  "data": {
    "id": "3EB0C25E6A...",
    "from": "5215512345678@s.whatsapp.net",
    "phone": "5215512345678",
    "pushName": "Juan",
    "type": "text",
    "body": "¡Hola! ¿Ya está mi pedido?",
    "isGroup": false
  }
}
```

Ese es el ciclo completo. El resto de la página entra en detalle.

## 🧭 Cómo funciona

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/architecture-dark.png">
  <source media="(prefers-color-scheme: light)" srcset=".github/assets/architecture-light.png">
  <img alt="Arquitectura de WACore: tu stack habla HTTP con WACore y WACore habla con WhatsApp por un WebSocket de Baileys" src=".github/assets/architecture-light.png">
</picture>

- **Un proceso, una línea.** Cada instancia de WACore gestiona un número de WhatsApp. Para varios números, levanta varias instancias, cada una con su `WA_INSTANCE_NAME`.
- **Salida:** tu código llama a la API REST (puerto `9878`). WACore valida la petición y envía el mensaje por el socket de Baileys. Para mostrar antes «escribiendo…», llama a `POST /api/presence`.
- **Entrada:** WACore normaliza cada evento de WhatsApp a un único payload y lo reparte a todos los canales que actives: webhooks, SSE y polling.
- **Estado:** las credenciales y claves viven en el session store que elijas. PostgreSQL guarda además contactos, etiquetas y plantillas, y aplica sus migraciones al arrancar.

## 📥 Recibir mensajes

Elige el canal que mejor encaje con tu stack. Puedes activar varios a la vez.

| Canal | Ideal para | Cómo |
|---|---|---|
| **Webhook** | Backends, serverless, n8n, Make, Zapier | `WEBHOOK_URL` + `WEBHOOK_SECRET`. Reintentos y circuit breaker incluidos. |
| **SSE** | Dashboards en vivo, workers de larga duración | `GET /api/messages/stream`, con filtros en servidor por tipo, teléfono y grupos |
| **Polling** | Cron jobs y los montajes más simples | `GET /api/messages?since=<cursor>` |

<details>
<summary><b>Verificar la firma del webhook (TypeScript)</b></summary>

Cada webhook lleva `X-WACore-Signature`, el HMAC-SHA256 en hexadecimal del cuerpo en bruto, con `WEBHOOK_SECRET` como clave.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function isFromWACore(rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

</details>

<details>
<summary><b>Respuesta automática por SSE (JavaScript)</b></summary>

```js
const API = "http://localhost:9878";
const KEY = "cambia-esto";

// EventSource no admite cabeceras: la clave va en la query
const events = new EventSource(`${API}/api/messages/stream?types=text&api_key=${KEY}`);

events.addEventListener("text", async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.body?.toLowerCase() === "ping") {
    await fetch(`${API}/api/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: msg.from, text: "pong 🏓" }), // responde siempre a `from`
    });
  }
});
```

</details>

<details>
<summary><b>Enviar desde Python</b></summary>

```python
import requests

requests.post(
    "http://localhost:9878/api/send",
    headers={"Authorization": "Bearer cambia-esto"},
    json={"to": "5215512345678", "text": "Tu pedido ya va en camino 📦"},
)
```

</details>

Referencia completa de payloads y tipos de evento: [`docs/message-reception.md`](docs/message-reception.md).

## 🧩 La API de un vistazo

Todas las rutas `/api/*` piden `Authorization: Bearer <API_KEY>` (o `?api_key=` para EventSource).

| Área | Endpoints |
|---|---|
| **Enviar** | `POST /api/send` (texto, respuestas) · `send-media` · `send-ptt` (notas de voz) · `send-sticker` · `send-location` · `send-contact` · `send-event` · `send-product` · `forward` |
| **Interactivos** *(opt-in)* | `POST /api/send-buttons` · `send-list` |
| **Mensajes** | editar `PATCH` · eliminar para todos `DELETE` · reaccionar · fijar · marcar como leído · descargar media |
| **Recibir** | `GET /api/messages` (polling) · `GET /api/messages/stream` (SSE) · webhooks |
| **Presencia** | indicadores de escribiendo / grabando · suscribirse a la presencia de un contacto |
| **Contactos** | agenda por línea · `POST /api/contacts/check` (quién tiene WhatsApp) · resync |
| **Grupos** | crear, participantes, asunto, descripción, ajustes, enlaces de invitación |
| **Chats** | archivar, fijar, silenciar, bloquear, borrar |
| **Perfil y más** | perfil y foto propios · etiquetas · plantillas locales · catálogo de productos |
| **Sesión** | `GET /api/status` · `GET /api/qr` · `POST /api/connect` · `DELETE /api/session` · `GET /health` (puerto 9877) |

Petición y respuesta de cada ruta: [`docs/api-rest.md`](docs/api-rest.md).

## ⚙️ Configuración

Todo se configura con variables de entorno. Estas son las primeras que vas a tocar:

| Variable | Default | Qué hace |
|---|---|---|
| `API_KEY` | — | Token Bearer de la API. **Si no se define, la API queda deshabilitada.** |
| `SESSION_STORE` | `postgres` | Dónde vive la sesión: `file`, `redis` o `postgres` |
| `DATABASE_URL` | — | Conexión a PostgreSQL (con `SESSION_STORE=postgres`) |
| `REDIS_URL` | `redis://localhost:6379` | Conexión a Redis (con `SESSION_STORE=redis`) |
| `WEBHOOK_URL` | — | A dónde hacer `POST` con los eventos entrantes |
| `WEBHOOK_SECRET` | — | Clave HMAC de la cabecera `X-WACore-Signature` |
| `WEBHOOK_EVENTS` | `message` | Eventos a enviar: `message`, `message.edit`, `message.status`, `presence`, `call`, `connection`, `qr`, `media.downloaded`, `history` |
| `WA_INSTANCE_NAME` | `default` | Nombre de esta línea; es la clave de la sesión en el store |

Todas las variables: [`docs/env-vars.md`](docs/env-vars.md) · Fichero de ejemplo: [`.env.example`](.env.example)

## 🚀 Producción

```bash
docker compose up -d   # WACore + PostgreSQL + Redis
```

- **Persistencia:** en producción usa `SESSION_STORE=postgres` o `redis`, o monta un volumen en `/data` con `file`. Perder la sesión obliga a escanear el QR otra vez.
- **Salud:** `GET /health` en el puerto `9877` no pide autenticación y devuelve `healthy`, `degraded` o `unhealthy`. La imagen trae un `HEALTHCHECK` de Docker.
- **Seguridad:** mantén el puerto `9878` en red privada o detrás de un proxy inverso con TLS. Usa una `API_KEY` larga y aleatoria, y comprueba `X-WACore-Signature` en cada webhook.
- **Imágenes:** cada tag `vX.Y.Z` publica `ghcr.io/pep3m/wacore:vX.Y.Z` y `latest`. En producción, fija una versión.

Más: [Docker](docs/docker.md) · [Persistencia de sesión](docs/session-persistence.md) · [Health check](docs/health-check.md) · [Conexión y QR](docs/whatsapp-connection.md)

## 🛠 Desarrollo

```bash
bun install
bun run dev      # modo watch
bun test         # más de 770 tests
```

En `front/` hay un pequeño panel de desarrollo en React (QR, estado, mensajes en vivo, envío). Se levanta con `docker compose -f docker-compose.dev.yml up`.

Las contribuciones son bienvenidas. Empieza por [CONTRIBUTING.md](CONTRIBUTING.md).

## ⚠️ Aviso legal

WACore es un proyecto open source independiente. **No está afiliado a WhatsApp ni a Meta, ni cuenta con su respaldo o patrocinio.** «WhatsApp» es una marca registrada de WhatsApp LLC.

WACore se conecta con el protocolo multidispositivo que usa WhatsApp Web. No es la [WhatsApp Business Platform](https://business.whatsapp.com/products/business-platform) oficial. Los clientes no oficiales pueden ir contra los Términos de Servicio de WhatsApp, y los números que envían spam o mensajes masivos no solicitados acaban baneados. Úsalo para conversaciones legítimas con gente que espera saber de ti, y bajo tu propia responsabilidad.

## 📄 Licencia

[MIT](LICENSE) © Pepe Marquez

<div align="center">
<br>
<sub>Si WACore te ahorra tiempo, una ⭐ ayuda a que otros desarrolladores lo encuentren.</sub>
</div>
