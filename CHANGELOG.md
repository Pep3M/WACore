# Changelog

Todas las versiones notables de WACore se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/).

---

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
