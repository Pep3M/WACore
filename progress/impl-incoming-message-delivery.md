# Reporte de Implementación — RF-04: Mecanismos de Entrega de Mensajes Entrantes (QA Fixes)

> **Versión:** 1.1
> **Fecha:** 2026-05-08
> **Estado:** Completado
> **Desarrollador:** @developer
> **Review de referencia:** `progress/review-incoming-message-delivery.md`

---

## Resumen

Se aplicaron los 5 fixes solicitados por QA (1 MAJOR, 4 MINOR) sobre los 3 archivos fuente de RF-04. Todos los cambios son retrocompatibles — la API pública (interfaces y behaviours esperados) no cambia. Todos los tests existentes (178/178) continúan pasando.

---

## Archivos modificados

| # | Archivo | Fixes |
|---|---------|-------|
| 1 | `src/transport/sse-transport.ts` | M-01, m-01, m-04 |
| 2 | `src/core/incoming-message-hub.ts` | m-02 |
| 3 | `src/transport/rest-api.ts` | m-03 |

---

## Detalles de implementación

### M-01 (MAJOR) — `stop()` no limpia handlers ni heartbeats

**Problema:** `activeStreams` era un `Set<ReadableStreamDefaultController>`. `stop()` solo cerraba los controllers sin limpiar los handlers registrados en el hub ni los heartbeat timers.

**Fix:**
1. `activeStreams` convertido a `Map<ReadableStreamDefaultController, StreamEntry>`, donde `StreamEntry` contiene `controller`, `heartbeatTimer` y `unsubHandler`.
2. En `handleConnection.start()`, después de crear `unsubHandler` y `heartbeatTimer`, se almacenan en el Map: `activeStreams.set(controller, { controller, heartbeatTimer, unsubHandler })`.
3. `stop()` ahora itera sobre `activeStreams.values()`, hace `clearInterval(entry.heartbeatTimer)`, llama `entry.unsubHandler()`, cierra `entry.controller`, y luego `activeStreams.clear()`.

### m-01 (MINOR) — `cancel()` no remueve controller de `activeStreams`

**Problema:** `cancel()` no tenía acceso al `controller` del stream para removerse de `activeStreams`.

**Fix:** Se añadió `let streamController: ReadableStreamDefaultController | null = null` al closure compartido de `handleConnection`. En `start()`, se asigna `streamController = controller`. En `cancel()`, se accede al Map via `streamController`, se limpia y elimina la entrada.

### m-02 (MINOR) — `since` inválido produce NaN silencioso

**Archivo:** `src/core/incoming-message-hub.ts`

**Problema:** `new Date(since).getTime()` con string inválido producía `NaN`, y `NaN > 0` es `false`, por lo que no se filtraba nada.

**Fix:** Se valida el timestamp con `isNaN()`:
```typescript
const sinceTs = since ? new Date(since).getTime() : 0;
const validSince = !isNaN(sinceTs) ? sinceTs : 0;
```

### m-03 (MINOR) — `limit` no numérico produce NaN

**Archivo:** `src/transport/rest-api.ts`

**Problema:** `parseInt('abc')` produce `NaN`, que pasaba como `limit` a `getRecentMessages` → `slice(0, NaN)` → array vacío.

**Fix:** Se normaliza `limit`:
```typescript
let limit = 50;
if (limitParam) {
  const parsed = parseInt(limitParam, 10);
  if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 200);
}
```
Se añadió un cap server-side de 200 (además del cap interno de 1000 en el hub).

### m-04 (MINOR) — Abort listener nunca se remueve

**Archivo:** `src/transport/sse-transport.ts`

**Problema:** El listener de abort se registraba pero nunca se removía.

**Fix:** Se añadió `{ once: true }` al `addEventListener`:
```typescript
req.signal.addEventListener('abort', cleanup, { once: true });
```

---

## Resultados

- **Typecheck:** `tsc --noEmit` → 0 errores
- **Tests:** `bun test` → 178/178 pass, 355 expect() calls
