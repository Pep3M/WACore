# Diseño de Arquitectura — Core Backend WACore

> **Versión:** 1.0
> **Fecha:** 2025-05-08
> **Estado:** Aprobado para implementación
> **Autor:** @software-architect
> **RF relacionados:** RF-01, RF-02, RF-03

---

## 1. Resumen

Backend reutilizable para automatización de WhatsApp usando Baileys v7 sobre Bun. Diseñado como imagen Docker para integrarse como servicio en proyectos de chatbot con IA. Arquitectura event-driven con pub/sub interno que desacopla la capa de conexión WhatsApp de la lógica de negocio y el transporte hacia sistemas externos.

El sistema reemplaza soluciones como Evolution API con una implementación propia: más control, menos dependencias, y total transparencia sobre el estado de la conexión.

### 1.1 Archivos a crear/modificar

| Archivo | RF | Propósito |
|---|---|---|
| `src/index.ts` | RF-01 | Entry point: bootstrap completo del sistema |
| `src/config.ts` | RF-01 | Carga y validación de variables de entorno |
| `src/types.ts` | RF-01 | Tipos compartidos del dominio |
| `src/baileys/client.ts` | RF-01.1 | Factory de makeWASocket + ciclo de vida |
| `src/baileys/events.ts` | RF-01.1 | Handlers de eventos Baileys → Event Bus |
| `src/baileys/auth.ts` | RF-01.1 | Persistencia de autenticación (wrapper) |
| `src/core/event-bus.ts` | RF-01 | Event emitter tipado interno |
| `src/core/message-router.ts` | RF-02 | Parseo y normalización de mensajes |
| `src/core/reconnection.ts` | RF-01.1 | Máquina de reconexión con backoff |
| `src/core/health.ts` | RF-01 | Servidor HTTP para health checks |
| `src/transport/webhook-dispatcher.ts` | RF-03 | Despacho de eventos a webhooks externos |
| `src/transport/rest-api.ts` | RF-03 | Endpoints REST opcionales |
| `src/transport/circuit-breaker.ts` | RF-03 | Circuit breaker para transporte |
| `src/storage/session-store.ts` | RF-01.1 | Interfaz abstracta de session store |
| `src/storage/file-store.ts` | RF-01.1 | Implementación filesystem |
| `src/storage/redis-store.ts` | RF-01.1 | Implementación Redis (futura) |
| `src/services/message-sender.ts` | RF-02 | Envío de mensajes WhatsApp |
| `src/utils/logger.ts` | RF-01 | Logger estructurado |
| `src/utils/retry.ts` | RF-01 | Utilidad de retry + backoff |
| `Dockerfile` | — | Build multi-stage para imagen Docker |
| `docker-compose.yml` | — | Orquestación local con servicios auxiliares |

---

## 2. Diseño detallado

### 2.1 Arquitectura general

```
┌──────────────────────────────────────────────────────────────┐
│                     WACore Container                          │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌───────────────────┐   │
│  │ WhatsApp │◄──►│  Baileys     │    │  Health Monitor    │   │
│  │ WebSocket│    │  Client      │    │  (Bun.serve :3000) │   │
│  └──────────┘    └──────┬───────┘    └───────────────────┘   │
│                         │                                     │
│                ┌────────▼────────┐                           │
│                │   Event Bus     │                           │
│                │  (EventEmitter) │                           │
│                └────────┬────────┘                           │
│                         │                                     │
│    ┌────────────────────┼────────────────────┐               │
│    │                    │                    │               │
│ ┌──▼────────┐   ┌──────▼───────┐   ┌────────▼───────┐      │
│ │  Message   │   │  Transport   │   │  Session        │      │
│ │  Router    │   │  Layer       │   │  Store          │      │
│ └────────────┘   └──────┬───────┘   └────────────────┘      │
│                         │                                     │
└─────────────────────────┼─────────────────────────────────────┘
                          │
                ┌─────────▼──────────┐
                │  External Services  │
                │  (IA, Webhooks,     │
                │   Queues, etc.)     │
                └────────────────────┘
```

**Separación de responsabilidades:**

- **Baileys Client**: Único módulo que conoce Baileys internamente. Inicializa el socket, maneja autenticación, y traduce eventos raw a eventos del dominio.
- **Event Bus**: Middleware interno. Desacopla productores (Baileys) de consumidores (Message Router, Transport Layer, etc.).
- **Message Router**: Transforma mensajes crudos de WhatsApp a tipos normalizados. No sabe cómo se envían ni a dónde van.
- **Transport Layer**: Serializa eventos y los envía a sistemas externos. No sabe nada de Baileys ni del formato interno de WhatsApp.
- **Session Store**: Abstracción de persistencia. Interfaz única, implementaciones intercambiables.

### 2.2 Event Bus (core/event-bus.ts)

```typescript
interface WACoreEventMap {
  'connection.update':   ConnectionUpdateEvent;
  'qr':                  QREvent;
  'creds.update':        CredsUpdateEvent;
  'message':             RawMessageEvent;
  'message.text':        TextMessageEvent;
  'message.image':       ImageMessageEvent;
  'message.video':       VideoMessageEvent;
  'message.document':    DocumentMessageEvent;
  'message.audio':       AudioMessageEvent;
  'message.reaction':    ReactionMessageEvent;
  'auth.logged-out':     LoggedOutEvent;
  'auth.state-change':   AuthStateChangeEvent;
  'webhook.circuit-open': CircuitOpenEvent;
  'error':               ErrorEvent;
}
```

Implementación con `EventEmitter` nativo de TypeScript/Bun, tipado genérico para evitar errores de tipos. Soporte para wildcards (`message.*`).

### 2.3 Baileys Client (baileys/client.ts)

```typescript
interface BaileysClientOptions {
  instanceName: string;
  sessionStore: SessionStore;
  eventBus: EventBus;
  logger: Logger;
  qrTimeout: number;
  connectOnStartup: boolean;
}

function createClient(opts: BaileysClientOptions): WASocket;
```

- Configura `makeWASocket` con auth state del session store.
- Maneja el ciclo de vida completo: connect → disconnect → reconnect → QR.
- Expone funciones controladas: `sendMessage`, `getStatus`, `disconnect`.
- No expone el socket raw; toda comunicación es vía Event Bus.

### 2.4 Session Store (storage/session-store.ts)

```typescript
interface SessionStore {
  save(data: AuthenticationState): Promise<void>;
  load(): Promise<AuthenticationState | null>;
  delete(): Promise<void>;
  exists(): Promise<boolean>;
}

type StoreType = 'file' | 'redis' | 'postgres';

function createSessionStore(type: StoreType, config: StoreConfig): SessionStore;
```

Implementación default: FileStore escribe en `SESSION_DIR/{instance_name}/` los archivos que Baileys necesita (`creds.json`, `pre-keys.json`, `sessions.json`, `app-state-sync-keys.json`). Mantiene backups rotativos de las últimas 3 versiones.

### 2.5 Reconnection Manager (core/reconnection.ts)

```typescript
type DisconnectReason = 
  | 'connectionReplaced' | 'timedOut' | 'loggedOut' 
  | 'unavailableService' | 'badSession' | 'restartRequired' 
  | 'multidevice' | 'forbidden';

interface BackoffConfig {
  initialDelay: number;
  maxDelay: number;
  factor: number;
  maxAttempts: number;
}

const BACKOFF_STRATEGIES: Record<DisconnectReason, BackoffConfig> = {
  connectionReplaced: { initialDelay: 1000, maxDelay: 5000, factor: 2, maxAttempts: 10 },
  timedOut:          { initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: 15 },
  unavailableService:{ initialDelay: 5000, maxDelay: 120000, factor: 2, maxAttempts: 20 },
  loggedOut:         { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0 },
  badSession:        { initialDelay: 1000, maxDelay: 10000, factor: 2, maxAttempts: 2 },
  restartRequired:   { initialDelay: 500, maxDelay: 5000, factor: 1.5, maxAttempts: 20 },
  multidevice:       { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0 },
  forbidden:         { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0 },
};
```

Para razones terminales (`loggedOut`, `forbidden`, `multidevice`) se limpia la sesión y se emite `auth.logged-out`. El sistema entra en modo QR.

### 2.6 Message Router (core/message-router.ts)

Recibe el evento `messaging-history.set` o `messages.upsert` de Baileys (según la versión de la API). Normaliza cada mensaje:

```typescript
interface NormalizedMessage {
  id: string;
  from: string;
  phone: string;
  pushName: string;
  isGroup: boolean;
  groupId: string | null;
  timestamp: number;
  type: MessageType;         // 'text' | 'image' | 'video' | 'document' | 'audio' | 'reaction'
  body: string | null;
  quotedMessage: QuotedMessage | null;
  media: MediaInfo | null;
}
```

Emite `message.{type}` con el mensaje normalizado. Si no se reconoce el tipo, emite `message` genérico.

### 2.7 Transport Layer (transport/webhook-dispatcher.ts)

Se suscribe al Event Bus y serializa los eventos seleccionados (`WEBHOOK_EVENTS`) como POST HTTP/HTTPS al `WEBHOOK_URL`.

Headers:
- `X-WACore-Event`: tipo de evento
- `X-WACore-Instance`: nombre de la instancia
- `X-WACore-Timestamp`: ISO timestamp
- `X-WACore-Signature`: HMAC-SHA256 del body

Incluye circuit breaker (transport/circuit-breaker.ts) con estados CLOSED → OPEN → HALF_OPEN. Previene flooding al webhook receptor si está caído.

### 2.8 REST API (transport/rest-api.ts)

Endpoints opcionales, habilitados solo si `API_KEY` está configurada:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `POST` | `/api/send` | Bearer | Enviar mensaje de texto |
| `POST` | `/api/send-media` | Bearer | Enviar media (imagen/video/doc) |
| `GET` | `/api/status` | Bearer | Estado completo de conexión |
| `GET` | `/api/qr` | Bearer | QR actual si no conectado |
| `DELETE` | `/api/session` | Bearer | Cerrar sesión y borrar credenciales |

### 2.9 Health Monitor (core/health.ts)

Servidor HTTP minimalista con `Bun.serve`. Endpoint `GET /health` devuelve:

```json
{
  "status": "healthy",
  "connection": "connected",
  "phone_number": "5215551234567",
  "uptime_seconds": 1234,
  "reconnections": 0
}
```

Sin autenticación (requerido por Docker/K8s health checks). No expone información sensible.

---

## 3. Flujo completo: mensaje entrante → respuesta IA

```
1. WhatsApp envía mensaje
2. Baileys recibe vía WebSocket
3. Baileys emite 'messages.upsert' internamente
4. events.ts captura y emite 'message' al Event Bus
5. Message Router recibe, parsea, determina tipo
6. Emite 'message.text' (o .image, etc.) al Event Bus
7. Webhook Dispatcher recibe, serializa, envía POST
8. Servicio IA recibe webhook, procesa, decide responder
9. Servicio IA hace POST /api/send a WACore
10. REST API recibe, valida, llama a message-sender.ts
11. message-sender.ts llama a Baileys sendMessage()
12. WhatsApp entrega mensaje al destinatario
```

Para integraciones locales (mismo proceso), el paso 7-9 se salta: el consumidor se suscribe directamente al Event Bus.

---

## 4. Edge Cases & Riesgos

| Edge Case | Handling |
|---|---|
| Sesión caduca (401) | Reconnection detecta `loggedOut`, limpia sesión, emite evento, entra modo QR |
| Otro dispositivo conecta (405) | Backoff corto, reintenta. Si persiste > N intentos, limpia sesión |
| Webhook caído | Circuit breaker se abre tras 5 fallos. Eventos se pierden (at-most-once) |
| Baileys cambia API | La capa de abstracción (event-bus) aísla el impacto. Solo cambiar baileys/ |
| Sesión corrupta al cargar | Intenta restaurar backup automático. Si falla, borra y solicita QR |
| Múltiples mensajes simultáneos | Event Bus maneja concurrencia naturalmente (async handlers) |
| Container restart sin sesión persistida | Volumen Docker debe persistir `/data/sessions`. Sin volumen → QR cada vez |
| QR expira antes de escanear | Timeout configurable (`QR_TIMEOUT`). Al expirar, genera nuevo QR |
| WhatsApp cambia protocolo | Baileys team normalmente actualiza rápido. Pin versión estable |

---

## 5. Plan de implementación

| Orden | Módulo | Tarea | Archivos | Deps |
|---|---|---|---|---|
| 1 | Core | Logger estructurado + tipos base | `utils/logger.ts`, `types.ts` | — |
| 2 | Core | Config desde env vars | `config.ts` | — |
| 3 | Core | Event Bus tipado | `core/event-bus.ts` | types |
| 4 | Storage | Interfaz SessionStore + FileStore | `storage/session-store.ts`, `storage/file-store.ts` | config |
| 5 | Baileys | Auth wrapper | `baileys/auth.ts` | session-store |
| 6 | Baileys | Cliente socket + ciclo de vida | `baileys/client.ts` | auth, event-bus, config |
| 7 | Baileys | Handlers de eventos | `baileys/events.ts` | client, event-bus |
| 8 | Core | Reconnection manager | `core/reconnection.ts` | event-bus, config |
| 9 | Core | Message Router | `core/message-router.ts` | event-bus, types |
| 10 | Core | Health monitor | `core/health.ts` | client |
| 11 | Transport | Circuit breaker | `transport/circuit-breaker.ts` | — |
| 12 | Transport | Webhook dispatcher | `transport/webhook-dispatcher.ts` | event-bus, circuit-breaker, config |
| 13 | Transport | REST API | `transport/rest-api.ts` | client, config |
| 14 | Services | Message sender | `services/message-sender.ts` | client |
| 15 | Entry | Bootstrap + wiring | `index.ts` | todos los anteriores |
| 16 | Infra | Dockerfile + docker-compose | `Dockerfile`, `docker-compose.yml`, `.dockerignore` | — |

---

## 6. Variables de entorno

| Variable | Requerida | Default | Descripción |
|---|---|---|---|
| `WA_INSTANCE_NAME` | Sí | — | Identificador único de la instancia |
| `HEALTH_PORT` | No | `3000` | Puerto del health check HTTP |
| `LOG_LEVEL` | No | `info` | debug, info, warn, error |
| `SESSION_STORE` | No | `file` | file, redis, postgres |
| `SESSION_DIR` | No | `/data/sessions` | Directorio para file-store |
| `REDIS_URL` | No | — | URL de Redis (para redis-store) |
| `WEBHOOK_URL` | No | — | URL destino de webhooks |
| `WEBHOOK_SECRET` | No | — | Clave HMAC para firmar webhooks |
| `WEBHOOK_EVENTS` | No | `message` | Eventos a webhook (csv) |
| `WEBHOOK_RETRY_COUNT` | No | `3` | Reintentos de webhook |
| `WEBHOOK_RETRY_DELAY` | No | `5000` | Delay entre reintentos (ms) |
| `API_KEY` | No | — | Habilita REST API si se define |
| `CONNECT_ON_STARTUP` | No | `true` | Conectar al arrancar |
| `QR_TIMEOUT` | No | `60000` | Timeout de QR (ms) |
| `NODE_ENV` | No | `production` | Entorno de ejecución |

---

## 7. Docker

### 7.1 Dockerfile

Multi-stage: 
- Stage 1: Instalar dependencias con bun install --frozen-lockfile
- Stage 2: Copiar solo lo necesario para runtime
- Usuario no-root (bun)
- HEALTHCHECK con curl a /health

### 7.2 docker-compose.yml

Servicios:
- `wacore`: Build local, monta volumen de sesiones, bind mount de src/ para hot-reload
- `redis`: Almacenamiento de sesiones opcional (imagen redis:7-alpine)
- `webhook-sink`: Endpoint para inspeccionar webhooks en desarrollo

---

## 8. Criterios de aceptación

- [ ] `bun run src/index.ts` arranca sin errores
- [ ] QR se muestra en terminal o se envía a webhook
- [ ] Sesión persiste tras reinicio del contenedor
- [ ] Reconexión automática tras timeout de red
- [ ] Webhook recibe payload JSON válido con mensaje entrante
- [ ] `POST /api/send` envía mensaje correctamente
- [ ] `GET /health` responde 200 con estado
- [ ] Logs en formato JSON a stdout
- [ ] Docker build exitoso sin secretos en la imagen

---

> **Próximo paso:** @developer implementa según este diseño, comenzando por los módulos base (logger, config, types, event-bus).
