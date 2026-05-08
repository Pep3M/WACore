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

---

## Orden de implementación recomendado

```
Orden 1:  Config → Logger → Types → Event Bus
Orden 2:  SessionStore → FileStore → Auth wrapper
Orden 3:  Cliente socket → Event handlers → Reconnection → Health
Orden 4:  Message Router → Message Sender
Orden 5:  Circuit Breaker → Webhook Dispatcher → REST API
Orden 6:  Bootstrap → Docker → Tests
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
