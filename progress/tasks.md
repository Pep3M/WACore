# Task Tracker

> Lista de features/tareas con su estado actual, responsable asignado, y fase del flujo de trabajo.

| ID | Feature / Tarea | Estado | Arquitecto | Developer | QA | Diseño | Implementación | Review |
|---|---|---|---|---|---|---|---|---|
| RF-01 | Conexión y autenticación WhatsApp | designing | @software-architect | — | — | done | — | — |
| RF-01.1 | Config + types base | planned | @software-architect | — | — | done | — | — |
| RF-01.2 | Logger estructurado | planned | @software-architect | — | — | done | — | — |
| RF-01.3 | Event Bus tipado | planned | @software-architect | — | — | done | — | — |
| RF-01.4 | SessionStore + FileStore | planned | @software-architect | — | — | done | — | — |
| RF-01.5 | Auth wrapper Baileys | planned | @software-architect | — | — | done | — | — |
| RF-01.6 | Cliente socket + ciclo de vida | planned | @software-architect | — | — | done | — | — |
| RF-01.7 | Handlers de eventos | planned | @software-architect | — | — | done | — | — |
| RF-01.8 | Reconnection manager | planned | @software-architect | — | — | done | — | — |
| RF-01.9 | Health monitor HTTP | planned | @software-architect | — | — | done | — | — |
| RF-01.10 | Bootstrap + wiring | planned | @software-architect | — | — | done | — | — |
| RF-02 | Sistema de mensajería | backlog | — | — | — | — | — | — |
| RF-02.1 | Message Router | planned | @software-architect | — | — | done | — | — |
| RF-02.2 | Message Sender | planned | @software-architect | — | — | done | — | — |
| RF-03 | Capa de integración externa | backlog | — | — | — | — | — | — |
| RF-03.1 | Circuit breaker | planned | @software-architect | — | — | done | — | — |
| RF-03.2 | Webhook dispatcher | planned | @software-architect | — | — | done | — | — |
| RF-03.3 | REST API | planned | @software-architect | — | — | done | — | — |
| INFRA-01 | Docker infraestructura | planned | @software-architect | — | — | done | — | — |
| INFRA-01.1 | Dockerfile multi-stage | planned | @software-architect | — | — | done | — | — |
| INFRA-01.2 | docker-compose.yml | planned | @software-architect | — | — | done | — | — |
| INFRA-01.3 | .dockerignore | done | @software-architect | — | — | done | — | — |

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
