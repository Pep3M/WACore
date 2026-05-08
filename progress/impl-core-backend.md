# Reporte de Implementación — RF-01+RF-02+RF-03+INFRA-01: Core Backend

> **Versión:** 1.0
> **Fecha:** 2025-05-08
> **Estado:** Completado
> **Desarrollador:** @developer
> **Diseño de referencia:** `progress/design-core-backend.md`

---

## Resumen

Implementación completa del backend WACore: 19 archivos fuente, sistema event-driven con pub/sub interno, capa de conexión WhatsApp vía Baileys, transporte hacia sistemas externos (webhooks + REST API), persistencia de sesión con failover a backups, reconexión automática con backoff adaptativo, health checks, y logger estructurado. Todo tipado en TypeScript estricto.

---

## Archivos creados/modificados

| # | Archivo | Propósito |
|---|---------|-----------|
| 1 | `src/types.ts` | Tipos compartidos del dominio (198 líneas) |
| 2 | `src/config.ts` | Carga y validación de env vars |
| 3 | `src/utils/logger.ts` | Logger estructurado JSON a stdout/stderr |
| 4 | `src/utils/retry.ts` | Retry con exponential backoff + jitter |
| 5 | `src/core/event-bus.ts` | Pub/sub tipado con async safety |
| 6 | `src/core/reconnection.ts` | Backoff strategies por disconnect reason |
| 7 | `src/core/health.ts` | Servidor HTTP para health checks |
| 8 | `src/core/message-router.ts` | Normalización y ruteo de mensajes |
| 9 | `src/storage/session-store.ts` | Interfaz + factory de session store |
| 10 | `src/storage/file-store.ts` | Implementación filesystem con backups |
| 11 | `src/storage/redis-store.ts` | Stub de RedisStore (no implementado) |
| 12 | `src/baileys/auth.ts` | Auth provider con debounce en save |
| 13 | `src/baileys/client.ts` | Wrapper de makeWASocket + ciclo de vida |
| 14 | `src/baileys/events.ts` | Placeholder para eventos complejos futuros |
| 15 | `src/services/message-sender.ts` | Envío de texto y media |
| 16 | `src/transport/circuit-breaker.ts` | Circuit breaker (closed/open/half-open) |
| 17 | `src/transport/webhook-dispatcher.ts` | Despacho de eventos a webhooks |
| 18 | `src/transport/rest-api.ts` | REST API con Bearer auth |
| 19 | `src/index.ts` | Bootstrap y wiring de todos los módulos |

---

## Detalles de implementación

### Módulos fundacionales (RF-01.1 — RF-01.3)

- **config.ts**: Carga síncrona desde `Bun.env`. Valida que `WA_INSTANCE_NAME` exista. Defaults para todas las variables.
- **types.ts**: 25 interfaces/tipos exportados, incluyendo `WACoreEventMap` que tipa todos los eventos del bus.
- **logger.ts**: 6 niveles (debug=10 a error=40). Salida JSON a stdout (info/debug/warn) o stderr (error). Soporte para `child()` con contexto pre-cargado.
- **retry.ts**: `retry<T>()` genérico. `calculateDelay()` con jitter aleatorio (0.5x-1.0x del delay calculado).

### Event Bus (RF-01.3)

Implementación propia (sin EventEmitter de Node). `createEventBus()` retorna objeto con `on()`, `once()`, `off()`, `emit()`, `removeAllListeners()`, `listenerCount()`. Async-safe: captura rejections de handlers async vía `.catch()`.

### Sesión y autenticación (RF-01.4 — RF-01.5)

- **SessionStore**: Interfaz abstracta (`save/load/delete/exists/backup`). Factory selecciona FileStore o RedisStore según config.
- **FileStore**: Persiste `creds.json` y `keys.json`. Backup rotativo (3 versiones). Restaura desde backup si falla la carga.
- **RedisStore**: Stub — `throw 'RedisStore not yet implemented'`.
- **AuthProvider**: Debounce de 1 tick en `saveCreds()` para evitar I/O excesivo en updates rápidos.

### Cliente Baileys (RF-01.6 — RF-01.7)

`createBaileysClient()` construye `makeWASocket` con:
- `printQRInTerminal: true` para QR en terminal
- Logger puente hacia el logger estructurado
- `syncFullHistory: false` (no descargar historial completo)
- Event listeners: `connection.update`, `creds.update`, `messages.upsert`
- Emite al Event Bus: `qr`, `connection.update`, `auth.logged-out`, `message`

### Reconexión (RF-01.8)

Tabla de estrategias por código de disconnect:
| Código HTTP | Reason | maxAttempts | Comportamiento |
|---|---|---|---|
| 401 | loggedOut | 0 | No reintenta, limpia sesión |
| 403 | forbidden | 0 | No reintenta |
| 405/440 | connectionReplaced | 10 | Backoff 1s-5s |
| 408 | timedOut | 15 | Backoff 1s-30s |
| 411 | multidevice | 0 | No reintenta |
| 500 | badSession | 2 | Reintenta 2 veces |
| 503 | unavailableService | 20 | Backoff 5s-120s |
| 515 | restartRequired | 20 | Backoff 500ms-5s |

### Message Router (RF-02.1)

Detecta tipo de mensaje por el contenido de `raw.message`:
- `conversation` / `extendedTextMessage` → text
- `imageMessage` → image
- `videoMessage` → video
- `documentMessage` → document
- `audioMessage` → audio
- `reactionMessage` → reaction
- Otros → ignorado silenciosamente

Extrae body, quoted message, y media info según el tipo. Emite `message.{type}` con el mensaje normalizado.

### Transport Layer (RF-03)

- **Circuit Breaker**: Estados closed → open (tras N fallos) → half-open (tras reset timeout). Previene flooding.
- **Webhook Dispatcher**: Se suscribe a eventos configurados en `WEBHOOK_EVENTS`. POST con headers de identificación. Retry con backoff. Circuit breaker integrado.
- **REST API**: Habilitado solo si `API_KEY` está definida. 5 endpoints: send, send-media, status, qr, delete-session.

---

## Decisiones de diseño

| Decisión | Justificación |
|---|---|
| Event Bus propio vs EventEmitter | Control total sobre tipado genérico, async safety, y sin dependencias externas |
| FileStore con backup rotativo | Protección contra corrupción de archivos sin necesidad de infraestructura externa |
| Re-emisión en `message` channel | El router recibe raw events y re-emite normalizados en el mismo canal; la detección de tipo filtra la recursión |
| Webhook at-most-once | Simplicidad. El circuito abre si el receptor está caído; eventos no encolados |
| HMAC deshabilitado | Pendiente de implementar con Web Crypto API. El header `X-WACore-Signature` se envía vacío |
| printQRInTerminal: true | Modo desarrollo/default; la app Docker puede silenciarlo vía env var si se requiere |
| VerbatimModuleSyntax | Alineado con tsconfig strict; todas las importaciones de tipo usan `import type` |

---

## Resultados

- **TypeScript:** Compila sin errores (`tsc --noEmit` → 0 errors)
- **Tests:** 85/85 pass (167 assertions) — event-bus, retry, circuit-breaker, reconnection, message-router, file-store, config, rest-api, health, auth, message-sender, logger, webhook-dispatcher
- **Coverage:** 13/19 archivos con tests directos (68%)
- **Build:** Docker multi-stage verificado
