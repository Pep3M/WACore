# Changelog

Todas las versiones notables de WACore se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/).

---

## [1.6.0] — 2026-09-27

### Changed
- **Runtime**: WACore vuelve a correr sobre **Bun** (≥ 1.4.2) en lugar de Node 22 + `tsx`. La imagen
  Docker parte de `oven/bun:1.4.2-alpine`, instala con `bun.lock` (`--frozen-lockfile`) y arranca con
  `bun src/index.ts`. `bun start` y `bun run dev` ya no pasan por `tsx`, que deja de ser dependencia.
  La API, las variables de entorno, los puertos, los volúmenes y el `HEALTHCHECK` (con `curl`) no
  cambian. El proceso corre como el usuario `bun` (uid 1000, el mismo uid que antes).
- Se elimina `package-lock.json`: el lockfile es `bun.lock`.

### Added
- README nuevo en inglés (`README.md`) y en español (`README.es.md`), con diagrama de arquitectura
  e imagen para compartir en redes (`.github/assets/`).
- `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, plantillas de issues y de PR.
- Workflow de CI (`ci.yml`): `bun test` con Bun 1.4.2 en cada push a `master` y en cada PR.
- Cada tag `vX.Y.Z` crea su GitHub Release con las notas de su sección del CHANGELOG
  (`scripts/changelog-notes.sh`).

### Fixed
- Docs: `SESSION_STORE` vale `postgres` por defecto (los docs decían `file`) y `WA_INSTANCE_NAME`
  vale `default`. El `docker run` de ejemplo añade `SESSION_STORE=file`: sin él, el contenedor se
  detenía al arrancar por falta de `DATABASE_URL`.
- Docs: las imágenes se publican como `ghcr.io/pep3m/wacore:vX.Y.Z` (con `v`).

---

## [1.5.1] — 2026-09-27

### Fixed
- **Recepción**: los estados que publican los contactos (`status@broadcast`) ya no se publican
  como mensajes. Llegaban al webhook con `phone: "status"` y el consumidor los tomaba por un
  chat nuevo; tampoco se descarga su media ni pasan por los acuses de lectura.

---

## [1.5.0] — 2026-09-25

### Added
- **Recepción**: los mensajes reenviados llegan con `isForwarded: true` y `forwardingScore`
  (cuántas veces se reenvió; desde 5 WhatsApp lo muestra como «Reenviado muchas veces»). En los
  demás mensajes los dos campos no vienen, así que el contrato de v1.4.0 no cambia.

---

## [1.4.0] — 2026-09-25

Incorpora las mejoras y correcciones desarrolladas desde v0.3.2. El contrato de v0.3.2 se
mantiene para los consumidores de una sola línea: rutas, auth por `API_KEY`, forma de las
respuestas y del webhook. Los tests de `src/__tests__/contract/` lo fijan.

### Added
- **Envío**: citar un mensaje (`quotedMessageId` en `POST /api/send`), stickers, ubicación,
  contactos, notas de voz (`/api/send-ptt`), reenvío (`POST /api/forward`), botones y listas
  (opt-in con `WACORE_INTERACTIVE_MESSAGES`), eventos de calendario y productos del catálogo.
- **Sobre mensajes enviados**: editar (`PATCH /api/messages/:chatId/:messageId`), revocar
  (`DELETE`), reaccionar (`POST .../reaction`) y fijar (`POST .../pin`).
- **Recepción**: notas de voz (`ptt`), stickers, ubicaciones, contactos, pedidos, productos,
  eventos y respuestas interactivas. Las reacciones indican a qué mensaje se reaccionó
  (`extras.targetId`). Las ediciones entrantes, con `WEBHOOK_EVENTS=...,message.edit`.
- **Eventos opt-in del webhook**: `presence` (el cliente está escribiendo o grabando),
  `message.status` (acuses enviado/entregado/leído), `call` (llamadas entrantes) y `history`
  (volcado de conversaciones al emparejar: `message.history` y `history.synced`). El SSE emite
  también `presence`, `message.status` y `call`.
- `POST /api/presence/subscribe` para recibir la presencia de un contacto.
- `POST /api/contacts/check`: qué números tienen WhatsApp. Agenda persistida en Postgres por
  línea, con `POST /api/contacts/resync`.
- Grupos, perfil propio y de contactos, etiquetas, acciones sobre chats (archivar, fijar,
  silenciar, bloquear, borrar), plantillas locales (`/api/templates`) y catálogo.
- `GET /api/status` añade `connection`, `phoneNumber`, `uptimeSeconds` y `reconnections`.
- Publicar los mensajes propios escritos desde el móvil (`WACORE_PUBLISH_FROM_ME`, opt-in).
- `LOG_FORMAT=pretty` para desarrollo.

### Fixed
- Las escrituras de credenciales se agrupan y ya no se pierden claves entre reinicios.
- La versión de WhatsApp Web se resuelve al arrancar (`WA_WEB_VERSION` para fijarla).
- Un corte de red largo ya no deja la línea muerta para siempre.
- Una sesión que nadie escanea deja de pedir QR tras `QR_MAX_ROUNDS` rondas (3 por defecto) y
  pasa a `disconnected`; se reanuda con `POST /api/connect`.
- Que otro cliente reemplace la sesión (`connectionReplaced`) ya no provoca una guerra de
  reconexiones.
- Los acuses de lectura con `@lid` ya pasan del primer tick.
- Postgres: plazos en el pool, vigilante de conexiones atascadas y espera de arranque con reloj
  monotónico. Diagnóstico de migraciones que se saltarían.
- Un registro ilegible del snapshot de app-state ya no deja la línea sin agenda.
- `/data/media` se crea en la imagen: los adjuntos entrantes fallaban con `EACCES`.
- `tsx` pasa a ser dependencia de producción: la imagen lo descargaba en cada arranque.

### Changed
- Las notas de voz entran como `type: "ptt"` (antes `audio`).
- Tipos de mensaje que antes se descartaban llegan ahora por el evento `message`. Un
  consumidor que solo espere texto debe filtrar por `data.type`.
- `GET /api/contacts` lee de la agenda persistida y pagina (`limit` 100 por defecto).
- `/health` devuelve `unhealthy` cuando la línea está desconectada (sigue respondiendo 200) y
  añade `transport.postgres`.
- Migraciones nuevas 0001–0006 (contactos, sesiones, etiquetas, plantillas). Se aplican solas
  sobre una base de v0.3.2.

## [0.3.2] — 2026-05-10

### Added
- RF-07 Media Download: DiskMediaStore, auto-download, y REST API para descargar medios
- Interfaz de envío de medios (imagen, video, documento, audio) en frontend
- Mejoras en Presence Manager

### Changed
- Documentación reorganizada en ficheros temáticos con índice (`docs/index.md`)

## [0.3.1] — 2026-05-10

### Fixed
- Presence & Typing Indicator (RF-06): composing/recording ya no requieren reset con `paused` entre cambios de tipo (ambos usan el mismo tag XML)
- Presencia con `duration` ahora refresca periódicamente para evitar auto-expiración de WhatsApp
- Normalización consistente de JIDs en typingTimers (key vs fullJid)

### Added
- Parámetro opcional `duration` en `POST /api/presence` para controlar cuánto tiempo se muestra composing/recording
- Auto-pause automático al expirar el duration (limpia timers/envía paused)
- Logging mejorado de debug a info para toda la traza de presencia

## [0.3.0] — 2026-05-10

### Added
- Presence & Typing Indicator (RF-06)
  - PresenceManager service con startTyping, stopTyping, setPresence, sendWithTyping
  - Endpoint REST `POST /api/presence` (tipos: composing, recording, paused, available, unavailable)
  - Auto-typing automático antes de responder comandos (configurable vía AUTO_TYPING)

## [0.2.0] — 2026-05-10

### Added
- Frontend de desarrollo y docker-compose para desarrollo local
- Postinstall script para parchear baileys automáticamente
- Temporizador de subida de pre-keys

### Changed
- Migración de Bun a Node.js + Express para compatibilidad Docker
- Unificación de frontend con conexión SSE única

### Fixed
- Reemplazo de APIs específicas de Bun con equivalentes Node.js
- Regeneración de QR reflejada en frontend via polling
- Preservación de sesión de WhatsApp al detener/levantar contenedor
- Reintentos PreKeyError via messages.update, reconexión SSE, parada de sesión
- Parche baileys getDecryptionJid para usar PN sobre LID, upload pre-keys
- Merge de pre-keys y tipos anidados en auth keys.get/set en lugar de reemplazar
- Resolución de JIDs LID a números de teléfono y filtrado de mensajes fromMe

## [0.1.1] — 2026-05-08

### Fixed
- DELETE /api/session ahora retorna 200 con `loggedOut: true` incluso si el socket de WhatsApp está cerrado
- Limpieza automática de sesión al recibir `loggedOut` desde Baileys (logout desde el móvil)
- Eliminado race condition donde `creds.update` re-creaba la sesión tras borrarla

### Changed
- `SESSION_STORE` por defecto pasa a `postgres`

## [0.1.0] — 2026-05-08

### Añadido
- Conexión y autenticación WhatsApp vía Baileys (RF-01)
  - Logger estructurado, Event Bus, SessionStore + FileStore
  - Cliente socket, event handlers, reconnection manager, health monitor
- Sistema de mensajería (RF-02)
  - Message Router, Message Sender
- Capa de integración externa (RF-03)
  - Circuit breaker, Webhook dispatcher, REST API
- Infraestructura Docker (INFRA-01)
  - Dockerfile multi-stage, docker-compose, .dockerignore
- RedisStore para sesiones (RF-01.11)
- Mecanismos de entrega de mensajes entrantes (RF-04)
  - IncomingMessageHub, Polling REST API, SSE Transport
- PostgreSQL Session Store (RF-05)
  - PostgresStore, migraciones Drizzle, integración Docker
