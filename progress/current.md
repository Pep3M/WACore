# Sesión actual

- **Feature en curso:** RF-06: Presence & Typing Indicator
- **Fase:** implementing → **done**
- **Inicio:** 2026-05-10
- **Agente:** @developer

## Bitácora

### Implementación RF-06 (2026-05-10)

**Archivos creados:**
- `src/services/presence-manager.ts` — PresenceManager service con startTyping, stopTyping, setPresence, sendWithTyping, stop
- `src/__tests__/presence-manager.test.ts` — 21 tests

**Archivos modificados:**
- `src/types/index.ts` — +PresenceType, +SendPresenceRequest, +autoTyping, +typingDurationMs en EnvConfig
- `src/config.ts` — +autoTyping, +typingDurationMs
- `.env.example` — +AUTO_TYPING, +TYPING_DURATION_MS
- `src/baileys/client.ts` — +sendPresenceUpdate en BaileysClient interface e impl
- `src/transport/rest-api.ts` — +sendPresence param, +POST /api/presence endpoint
- `src/index.ts` — wiring de PresenceManager, auto-typing hook en command registry, shutdown

**Tests:** 209 pass, 5 fail (pre-existing, todos anteriores a RF-06)
**Typecheck:** 0 errores en src/

### Detalle de implementación

**PresenceManager** (`src/services/presence-manager.ts`):
- `setPresence(jid, type)` → envía cualquier tipo de presencia vía `socket.sendPresenceUpdate()`
- `startTyping(jid)` → envía `composing` y renueva cada `typingDurationMs` (default 3s)
- `stopTyping(jid)` → envía `paused` y limpia el intervalo
- `sendWithTyping(jid, sendFn)` → genérico: envía composing, espera 800ms, ejecuta sendFn, envía paused (respeta autoTyping config)
- `stop()` → limpia todos los timers activos

**Auto-typing**: El command registry usa `sendWithTyping` para envolver `sendText`, activando la burbuja de "escribiendo..." antes de cada respuesta automática. Se desactiva con `AUTO_TYPING=false`.

**API REST**: `POST /api/presence` acepta `{ to, type }` con validación de types válidos.

## Resumen de sesión

| Feature | Estado |
|---------|--------|
| RF-06 Presence & Typing | ✅ **done** |
| RF-07 Media Download | backlog |
| RF-08 Read Receipts | backlog |
| RF-09 Reactions | backlog |
| RF-10 Quoted Messages | backlog |
| RF-11 Group Management | backlog |
| RF-12 Stickers/PTV | backlog |
| RF-13 Location/Contact | backlog |
| RF-14 Polls | backlog |
| RF-15 Chat Management | backlog |
| RF-16 Comandos avanzados | backlog |
| RF-17 Newsletter | backlog |
| RF-18 Business Profile | backlog |
