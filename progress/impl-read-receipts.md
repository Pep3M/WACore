# Implementación — RF-08: Read Receipts

> **Fecha:** 2026-05-10
> **Estado:** done
> **Autor:** @developer

## Archivos creados

- `src/services/read-receipt-manager.ts` — Servicio con `sendReadReceipt()`, `start()`, `stop()`
- `src/__tests__/read-receipt-manager.test.ts` — 18 tests unitarios

## Archivos modificados

- `src/types/index.ts` — +`autoRead: boolean` en `EnvConfig`, +`ReadReceiptRequest` interface
- `src/config.ts` — +`autoRead: process.env.AUTO_READ === 'true'`
- `.env.example` — +`AUTO_READ=false` documentado
- `src/baileys/client.ts` — +`readMessages()` en `BaileysClient` interface + implementación
- `src/transport/rest-api.ts` — +`sendReadReceipt` callback param, +`POST /api/read` endpoint
- `src/index.ts` — Wiring de `ReadReceiptManager`, callback REST, start/stop/shutdown
- 19 archivos de test actualizados con `autoRead: false`

## Detalle de implementación

### ReadReceiptManager (`src/services/read-receipt-manager.ts`)

Factory: `createReadReceiptManager(client, eventBus, config, logger)` → `ReadReceiptManager`

**`sendReadReceipt(to, messageIds, participant?)`:**
- Normaliza JIDs sin sufijo `@s.whatsapp.net`
- Construye `WAMessageKey[]` con `fromMe: false`
- Si `participant` existe, lo normaliza e incluye en cada key
- Delega en `client.readMessages(keys)`

**`start()`:**
- Si `config.autoRead === false`: log y return
- Si `config.autoRead === true`: se suscribe a `eventBus.on('message', ...)` 
- El handler extrae `key.remoteJid`, `key.id`, `key.participant` del mensaje raw
- Fire-and-forget con `.catch()` para errores

**`stop()`:**
- Llama a `unsubscribe()`, limpia la variable

**Mejora sobre el diseño:** `start()` hace `unsubscribe?.()` antes de suscribir para ser idempotente.

### REST API `POST /api/read`

- Requiere autenticación API key (comportamiento existente)
- Devuelve 404 si `sendReadReceipt` callback no configurado
- Valida `to` (obligatorio) → 400
- Valida que al menos `messageId` o `messageIds` presente → 400
- Si ambos, `messageIds` tiene prioridad
- `participant` opcional
- Éxito: `{ success: true }`
- Error: `{ success: false, error: "..." }` con status 500

### Configuración

- `AUTO_READ=true` → auto-read activado, todo mensaje entrante se marca como leído
- `AUTO_READ=false` o no definido → sin auto-read (default)
- El endpoint REST funciona independientemente de `AUTO_READ`

## Tests

**18 tests (18 pass, 0 fail):**

- `sendReadReceipt` individual chat
- `sendReadReceipt` múltiples ids
- `sendReadReceipt` grupo con participant
- Normalización JID sin `@`
- No doble-sufijo JID con `@`
- Normalización participant sin `@`
- No doble-sufijo participant con `@`
- Error lanzado si `readMessages` falla
- Suscripción a `message` event cuando `autoRead: true`
- No suscripción cuando `autoRead: false`
- Auto-read con JID y message ID correctos
- Auto-read con participant para grupo
- Auto-read skips mensajes sin jid/id
- Auto-read maneja errores sin crash
- `stop()` desuscribe del event bus
- `stop()` seguro sin `start()`
- `stop()` idempotente
- `start()` múltiple es idempotente (solo 1 listener)

## Criterios de aceptación

- [x] `POST /api/read` con `{ to, messageId }` devuelve `{ success: true }`
- [x] `POST /api/read` con `{ to, messageIds[] }` devuelve `{ success: true }`
- [x] `POST /api/read` con `{ to, messageIds[], participant }` para grupos devuelve `{ success: true }`
- [x] `POST /api/read` sin `to` devuelve 400
- [x] `POST /api/read` sin `messageId` ni `messageIds` devuelve 400
- [x] Cuando `AUTO_READ=true`, cada mensaje entrante dispara un read receipt
- [x] Cuando `AUTO_READ=false` (default), no se envían read receipts automáticos
- [x] El endpoint devuelve 404 si `sendReadReceipt` no está disponible
- [x] No interfiere con auto-typing (RF-06) — ambos pueden estar activos simultáneamente
- [x] Socket no inicializado → error manejado sin crash
- [x] Tests pasan: `bun test`
- [x] TypeScript compila sin errores: `bun build src/index.ts`
