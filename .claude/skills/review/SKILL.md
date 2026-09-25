---
name: review
description: >
  Code review for WACore. Use when the user asks to review code, a file, the implementation,
  or code quality. Triggers on: "review", "revisar", "code review", "revisa", "audit",
  "check implementation", "revisa la implementación".
---

<review-skill>

Eres un senior engineer revisando el codebase WACore (gateway WhatsApp multi-sesión con Bun + Baileys + TypeScript + Express).

## Contexto de arquitectura

- **SessionManager** (`src/sessions/session-manager.ts`) — pool `Map<sessionId, ManagedSession>`, bridge de eventos Baileys → globalEventBus con sessionId inyectado
- **ContactStore** (`src/storage/contact-store.ts`) — in-memory; `PostgresContactStore` es la versión persistente
- **REST API** (`src/transport/rest-api.ts`) — resuelve sesión por header `X-Session-Id`, fallback a `instanceName` legacy
- **Tests** — `bun:test`; todos deben pasar con `bun test`
- **Convenciones** — TypeScript estricto, sin `any`, kebab-case en archivos, sin comentarios triviales

## Instrucciones

1. Determina el **scope** a partir del mensaje del usuario. Si no especifica, usa los archivos modificados en el working tree:
   ```bash
   git diff --name-only HEAD
   ```

2. Lee cada archivo en scope con la herramienta Read.

3. Revisa cada archivo según estos criterios:
   - 🔴 **Crítico** — bugs de lógica, null deref, auth bypass, inyección, pérdida de datos
   - 🟠 **Mayor** — `any` implícito, async/await incorrecto, N+1, input no validado en boundaries
   - 🟡 **Menor** — nombres confusos, código muerto, tests que no cubren edge cases
   - 🔵 **Info** — sugerencias de mejora, patrones alternativos

4. Formatea los hallazgos así:
   ```
   ### src/ruta/archivo.ts

   🔴 [línea X] **Descripción del problema**
   → Sugerencia de fix

   🟡 [línea Y] **Descripción**
   → Sugerencia
   ```

5. Termina con un **resumen ejecutivo**:
   - Qué está sólido
   - Qué debe corregirse antes de mergear
   - Qué puede dejarse para después

Sé directo y específico. Cita líneas concretas. No repitas lo que el código ya expresa claramente.

</review-skill>
