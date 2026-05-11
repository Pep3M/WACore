# Task Tracker

> Lista de features/tareas con su estado actual, responsable asignado, y fase del flujo de trabajo.

| ID | Feature / Tarea | Estado | Arquitecto | Developer | QA | Diseño | Implementación | Review |
|---|---|---|---|---|---|---|---|---|
| RF-01 | Conexión y autenticación WhatsApp | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.1 | Config + types base | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.2 | Logger estructurado | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.3 | Event Bus tipado | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.4 | SessionStore + FileStore | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.5 | Auth wrapper Baileys | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.6 | Cliente socket + ciclo de vida | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.7 | Handlers de eventos | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.8 | Reconnection manager | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.9 | Health monitor HTTP | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-01.10 | Bootstrap + wiring | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-02 | Sistema de mensajería | done | — | @developer | @qa-tester | done | done | approved |
| RF-02.1 | Message Router | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-02.2 | Message Sender | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-03 | Capa de integración externa | done | — | @developer | @qa-tester | done | done | approved |
| RF-03.1 | Circuit breaker | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-03.2 | Webhook dispatcher | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-03.3 | REST API | done | @software-architect | @developer | @qa-tester | done | done | approved |
| INFRA-01 | Docker infraestructura | done | @software-architect | @developer | @qa-tester | done | done | approved |
| INFRA-01.1 | Dockerfile multi-stage | done | @software-architect | @developer | @qa-tester | done | done | approved |
| INFRA-01.2 | docker-compose.yml | done | @software-architect | @developer | @qa-tester | done | done | approved |
| INFRA-01.3 | .dockerignore | done | @software-architect | — | — | done | — | — |
| RF-01.11 | RedisStore (almacenamiento sesiones Redis) | done | — | @developer | — | — | done | — |
| RF-04 | Mecanismos de Entrega de Mensajes Entrantes | done | — | @developer | @qa-tester | — | done | approved |
| RF-04.1 | IncomingMessageHub (RingBuffer + handlers) | done | — | @developer | @qa-tester | — | done | approved |
| RF-04.2 | Polling REST API (GET /api/messages) | done | — | @developer | @qa-tester | — | done | approved |
| RF-04.3 | SSE Transport (GET /api/messages/stream) | done | — | @developer | @qa-tester | — | done | approved |
| RF-05 | PostgreSQL Session Store | done | @software-architect | @developer | @qa-tester | done | done | approved |
| RF-05.1 | PostgresStore (SessionStore impl) | done | — | @developer | @qa-tester | — | done | approved |
| RF-05.2 | Migraciones automáticas (Drizzle) | done | — | @developer | @qa-tester | — | done | approved |
| RF-05.3 | Docker entrypoint + compose | done | — | @developer | @qa-tester | — | done | approved |
| RF-06 | Presence & Typing Indicator | done | @software-architect | @developer | — | done | done | — |
| RF-06.1 | PresenceManager service | done | — | @developer | — | — | done | — |
| RF-06.2 | API REST presence endpoint | done | — | @developer | — | — | done | — |
| RF-06.3 | Auto-typing al responder | done | — | @developer | — | — | done | — |
| RF-07 | Recepción y descarga de medios | done | — | @developer | — | — | done | — |
| RF-07.1 | MediaDownloader (downloadMediaMessage) | done | — | @developer | — | — | done | — |
| RF-07.2 | MediaStore en disco | done | — | @developer | — | — | done | — |
| RF-07.3 | API REST GET /api/media/:id | done | — | @developer | — | — | done | — |
| RF-07.4 | Media en webhooks y normalized messages | done | — | @developer | — | — | done | — |
| RF-08 | Read Receipts | backlog | — | — | — | — | — | — |
| RF-08.1 | Marcar mensaje como leído | backlog | — | — | — | — | — | — |
| RF-08.2 | API REST POST /api/read | backlog | — | — | — | — | — | — |
| RF-08.3 | Auto-read configurable | backlog | — | — | — | — | — | — |
| RF-09 | Reacciones a mensajes | backlog | — | — | — | — | — | — |
| RF-09.1 | Send reaction vía API | backlog | — | — | — | — | — | — |
| RF-09.2 | Recibir/normalizar reacciones | backlog | — | — | — | — | — | — |
| RF-10 | Mensajes con quoted/reply | backlog | — | — | — | — | — | — |
| RF-10.1 | quoted en sendText y sendMedia | backlog | — | — | — | — | — | — |
| RF-11 | Gestión de grupos | backlog | — | — | — | — | — | — |
| RF-11.1 | Crear grupo | backlog | — | — | — | — | — | — |
| RF-11.2 | Participantes (add/remove/kick/promote/demote) | backlog | — | — | — | — | — | — |
| RF-11.3 | Settings del grupo | backlog | — | — | — | — | — | — |
| RF-11.4 | Metadata del grupo | backlog | — | — | — | — | — | — |
| RF-11.5 | Invite codes | backlog | — | — | — | — | — | — |
| RF-12 | Envío de stickers y PTU (video note) | backlog | — | — | — | — | — | — |
| RF-13 | Mensajes de ubicación y contacto | backlog | — | — | — | — | — | — |
| RF-14 | Encuestas (Poll messages) | backlog | — | — | — | — | — | — |
| RF-15 | Chat Management (archive, pin, mute) | backlog | — | — | — | — | — | — |
| RF-16 | Comandos avanzados (middleware, permisos) | backlog | — | — | — | — | — | — |
| RF-17 | Newsletter | backlog | — | — | — | — | — | — |
| RF-18 | Business Profile & Catalog | backlog | — | — | — | — | — | — |

---

## Orden de implementación recomendado

```
Orden 1:  Config → Logger → Types → Event Bus
Orden 2:  SessionStore → FileStore → Auth wrapper
Orden 3:  Cliente socket → Event handlers → Reconnection → Health
Orden 4:  Message Router → Message Sender
Orden 5:  Circuit Breaker → Webhook Dispatcher → REST API
Orden 6:  Bootstrap → Docker → Tests
Orden 7:  RF-06 Presence/Typing → RF-07 Media Download → RF-08 Read Receipts
Orden 8:  RF-09 Reactions → RF-10 Quoted Messages → RF-11 Group Management
Orden 9:  RF-12 Stickers/PTV → RF-13 Location/Contact → RF-14 Polls
Orden 10: RF-15 Chat Management → RF-16 Commands Avanzados
Orden 11: RF-17 Newsletter → RF-18 Business Profile
```

---

## Estados posibles

- **backlog** — Definida pero no planificada
- **designing** — Arquitecto diseñando la solución
- **planned** — Diseño completado, lista para implementar
- **implementing** — Developer trabajando en la implementación
- **testing** — QA verificando la implementación
- **done** — Feature completada y verificada

## Flujo de trabajo

```
backlog → designing → planned → implementing → testing → done
                           ↑                     │
                           └─────────────────────┘ (cambios solicitados por QA)
```
