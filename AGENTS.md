# AGENTS.md

> Instrucciones para asistentes AI que trabajen en WACore.

## Stack

- **Runtime**: Bun
- **WhatsApp**: baileys (WebSocket, TypeScript)
- **Testing**: bun:test
- **Package manager**: bun

## Estructura del proyecto

```
WACore/
├── src/
│   ├── baileys/          # Capa de conexión WhatsApp
│   │   ├── client.ts     # Inicialización y gestión del socket
│   │   ├── events.ts     # Handlers de eventos
│   │   └── auth.ts       # Persistencia de autenticación
│   ├── services/         # Lógica de negocio
│   ├── storage/          # Capa de persistencia
│   ├── commands/         # Sistema de comandos del bot
│   │   └── registry.ts
│   ├── utils/            # Utilidades compartidas
│   └── index.ts          # Entry point
├── .opencode/
│   └── agents/           # Subagentes especializados
├── progress/             # Sistema de trazabilidad
└── AGENTS.md             # Este archivo
```

## Subagentes (`.opencode/agents/`)

| Agente | Archivo | Rol |
|--------|---------|-----|
| `@software-architect` | `software-architect.md` | Diseño de arquitectura |
| `@developer` | `developer.md` | Implementación de features |
| `@qa-tester` | `qa-tester.md` | Revisión QA, quality gate |

### Flujo entre subagentes

```
Humano asigna feature
  → @software-architect: diseña → progress/design-{feature}.md
    → @developer: implementa → progress/impl-{feature}.md
      → @qa-tester: revisa → progress/review-{feature}.md
        → APPROVED / CHANGES_REQUESTED / REJECTED
```

## Sistema de progreso (`progress/`)

```
backlog → designing → planned → implementing → testing → done
```

| Archivo | Propósito |
|---------|-----------|
| `requirements.md` | Requisitos funcionales y no funcionales |
| `tasks.md` | Tracker de features con estados |
| `current.md` | Bitácora en tiempo real de la sesión actual |
| `history.md` | Historial de sesiones cerradas (append-only) |

## Convenciones de código

- TypeScript estricto, sin `any`
- kebab-case para nombres de archivo
- Tests con `bun:test`
- Variables de entorno en `.env.example`
