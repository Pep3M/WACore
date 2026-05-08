# Task Tracker

> Lista de features/tareas con su estado actual, responsable asignado, y fase del flujo de trabajo.

| ID | Feature | Estado | Arquitecto | Developer | QA | Diseño | Implementación | Review |
|----|---------|--------|------------|-----------|-----|--------|---------------|--------|
| RF-01 | Conexión y autenticación WhatsApp | backlog | — | — | — | — | — | — |
| RF-02 | Sistema de comandos | backlog | — | — | — | — | — | — |
| RF-03 | Agente LLM conversacional | backlog | — | — | — | — | — | — |

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
