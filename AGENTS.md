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
| `versions.md` | Registro de versiones publicadas (tags Docker) |

## Documentación (`docs/`)

La documentación del proyecto está organizada en ficheros temáticos dentro de `docs/`. Para consultarla, usa el índice en [`docs/index.md`](docs/index.md):

| Archivo | Contenido |
|---------|-----------|
| `index.md` | Índice y organización de la documentación |
| `quick-start.md` | Primeros pasos |
| `docker.md` | Uso con Docker |
| `env-vars.md` | Variables de entorno |
| `whatsapp-connection.md` | Conexión a WhatsApp y QR |
| `api-rest.md` | API REST completa |
| `message-reception.md` | SSE, webhook y polling |
| `session-persistence.md` | Persistencia de sesión |
| `examples.md` | Ejemplos de uso |
| `health-check.md` | Health check |

## Convenciones de código

- TypeScript estricto, sin `any`
- kebab-case para nombres de archivo
- Tests con `bun:test`
- Variables de entorno en `.env.example`

## Versionado y releases

WACore usa [SemVer](https://semver.org/) estricto: `v<major>.<minor>.<patch>`.

| Tipo | Cuándo | Ejemplo |
|------|--------|---------|
| **patch** | Bugs, refactors, cambios menores **(default)** | `v0.1.0` → `v0.1.1` |
| **minor** | Nuevas features, cambios no rompientes | `v0.1.0` → `v0.2.0` |
| **major** | Breaking changes, rewrites | `v0.1.0` → `v1.0.0` |

### Flujo para desplegar una nueva versión

Ya no se despliega con un simple push a `master`. El flujo correcto es:

1. **Determinar el tag que toca**
   - Leer `progress/versions.md` para ver la última versión.
   - Por defecto incrementar **patch** (`v0.1.0` → `v0.1.1`).
   - Si el usuario pide explícitamente "nueva feature" o "breaking change", usar minor o major respectivamente.

2. **Actualizar `CHANGELOG.md`**
   - Mover los features completados de `[Unreleased]` a la nueva versión.
   - Describir los cambios que incluye este release.

3. **Actualizar `progress/versions.md`**
   - Añadir la entrada de la nueva versión con fecha y features incluidas.

4. **Actualizar `package.json`**
   - Cambiar el campo `version` al nuevo número.

5. **Crear y pushear el tag**
   ```bash
   git add CHANGELOG.md progress/versions.md package.json
   git commit -m "release: v0.1.1"
   git tag v0.1.1
   git push origin master --tags
   ```

6. **El CI (`docker-build.yml`) detecta el tag `v*.*.*`** y genera automáticamente la imagen Docker con tag `v0.1.1` (además de `latest`).
