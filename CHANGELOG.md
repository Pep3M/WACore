# Changelog

Todas las versiones notables de WACore se documentan aquí.

Formato basado en [Keep a Changelog](https://keepachangelog.com/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/).

---

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
