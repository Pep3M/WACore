# CLAUDE.md

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
├── front/                # Frontend
├── docs/                 # Documentación
├── migrations/           # Migraciones de base de datos
└── CLAUDE.md             # Este archivo
```

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
| `contacts.md` | API de contactos (agenda por línea) |
| `templates.md` | Plantillas locales de mensajes |

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

1. **Determinar el tag que toca**
   - Ver la última versión en `package.json` o `git tag`.
   - Por defecto incrementar **patch**. Si hay nuevas features usar minor; si hay breaking changes, major.

2. **Actualizar `CHANGELOG.md`**
   - Mover los cambios de `[Unreleased]` a la nueva versión.

3. **Actualizar `package.json`**
   - Cambiar el campo `version` al nuevo número.

4. **Crear y pushear el tag**
   ```bash
   git add CHANGELOG.md package.json
   git commit -m "release: v0.x.y"
   git tag v0.x.y
   git push origin master --tags
   ```

5. **El CI (`docker-build.yml`) detecta el tag `v*.*.*`**: genera la imagen Docker con ese tag (además de `latest`) y crea la GitHub Release con las notas de esa versión del `CHANGELOG.md` (`scripts/changelog-notes.sh`). Si el CHANGELOG no tiene sección para el tag, el job de release falla.
