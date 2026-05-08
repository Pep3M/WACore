# Diseño de Arquitectura — RF-05: PostgreSQL Session Store

> **Versión:** 1.0
> **Fecha:** 2026-05-08
> **Estado:** En diseño — pendiente aprobación
> **Autor:** @software-architect
> **RF relacionados:** RF-05.1 (PostgresStore), RF-05.2 (Migraciones), RF-05.3 (Docker entrypoint)
> **Dependencias:** drizzle-orm, postgres (porsager/postgres)

---

## 1. Resumen ejecutivo

WACore requiere soportar PostgreSQL como tercer backend de persistencia para las credenciales de autenticación de WhatsApp (`creds` + `keys`), sumándose a los ya existentes `file` y `redis`. La solución debe incluir un sistema de migraciones automáticas que se ejecuten al arrancar (sin intervención manual), un mecanismo de espera para garantizar que la base de datos esté disponible antes de iniciar, y una imagen Docker que siga siendo ligera. El diseño usa **Drizzle ORM + `postgres` (porsager)** como stack mínimo, con migraciones SQL generadas en desarrollo y aplicadas programáticamente en runtime.

---

## 2. Propuesta técnica

### 2.1 Elección de driver/ORM: Drizzle ORM + `postgres` (porsager/postgres)

| Candidato | Tamaño aprox | Migraciones built-in | Type-safe | Bun-compatible |
|-----------|-------------|---------------------|-----------|----------------|
| **Drizzle ORM + `postgres`** | ~100 kB gzip | ✅ vía `drizzle-kit` (dev) + `migrator` (runtime) | ✅ schema en TS | ✅ nativo |
| `pg` (node-postgres) | ~500 kB | ❌ hay que escribirlas a mano | ❌ | ✅ vía compat |
| `postgres` solo + SQL raw | ~50 kB | ❌ hay que escribirlas a mano | ❌ | ✅ nativo |

**Decisión: Drizzle ORM con driver `postgres` (porsager/postgres).**

Razones:
- **Tree-shakeable**: solo el código de los schemas que uses acaba en el bundle.
- **Migraciones standalone**: `drizzle-kit generate` produce archivos `.sql` que se ejecutan en runtime con `drizzle-orm/migrator`, sin necesidad de `drizzle-kit` en producción.
- **Bun-native**: el driver `postgres` (porsager) funciona sobre la capa de compatibilidad `node:net` de Bun sin dependencias nativas.
- **Tipado completo**: el schema se define en TypeScript y se infiere el tipo de filas automáticamente.
- **Dependencia ligera en runtime**: `drizzle-orm` (~51 kB) + `postgres` (~50 kB). Total: ~100 kB gzip. Compárese con `pg` (~500 kB) que además requeriría un migration runner propio.

En `package.json`:
```json
{
  "dependencies": {
    "drizzle-orm": "^0.40.0",
    "postgres": "^3.4.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0"
  }
}
```

### 2.2 Esquema de base de datos

Una única tabla `wacore_sessions` con clave primaria por `instance_name`. Los datos de `creds` y `keys` se almacenan como `JSONB` (Baileys ya serializa los Buffers a JSON mediante `BufferJSON.replacer`).

```sql
CREATE TABLE IF NOT EXISTS wacore_sessions (
  instance_name TEXT PRIMARY KEY,
  creds         JSONB NOT NULL,
  keys          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Por qué `TEXT` PK en vez de `UUID`**: porque `instance_name` es el identificador natural (proviene de `WA_INSTANCE_NAME`) y las queries son siempre `WHERE instance_name = $1`. Un UUID añadiría complejidad sin beneficio.

**Por qué `JSONB` en vez de `BYTEA`**: `JSONB` permite indexar si en el futuro se necesita, y `BufferJSON.replacer` ya convierte los Buffers a objetos JSON (`{type: "Buffer", data: [...]}`) que PostgreSQL puede almacenar. Al cargar, `BufferJSON.reviver` reconstruye los Buffers. Este es el mismo mecanismo que usan `FileStore` y `RedisStore`.

**Índices**: la PK (`instance_name`) ya proporciona un índice único. No se requieren índices adicionales para el acceso actual (siempre es lookup por `instance_name`).

**Tabla de migraciones**: `drizzle-orm/migrator` crea automáticamente la tabla `__drizzle_migrations` para trackear qué migraciones se han aplicado.

El schema Drizzle equivalente:
```typescript
// src/storage/postgres-db.ts
import { pgTable, text, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const sessions = pgTable('wacore_sessions', {
  instanceName: text('instance_name').primaryKey(),
  creds:        jsonb('creds').notNull(),
  keys:         jsonb('keys').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

### 2.3 Sistema de migraciones

#### Flujo de desarrollo

```
[dev modifica schema.ts]
  → bunx drizzle-kit generate
    → genera migrations/0001_snapshot.sql
      → se commitea a git
```

#### Flujo en producción (arranque del contenedor)

```
Container arranca
  → index.ts detecta SESSION_STORE=postgres
    → waitForPostgres(databaseUrl): retry loop 30s
      → runMigrations(databaseUrl): drizzle-orm/migrator lee migrations/*.sql
        → aplica SQL no ejecutados (idempotente, tabla __drizzle_migrations)
          → app inicia normalmente
```

`drizzle-kit` **nunca** se instala en la imagen de producción. Solo `drizzle-orm` (que incluye el `migrator`). Los archivos `.sql` se copian al contenedor:

```dockerfile
COPY migrations/ ./migrations/
```

#### ¿Por qué migraciones basadas en archivos SQL y no programáticas?

- **Determinismo**: un archivo `.sql` es auditable, versionable, y se puede revisar en code review.
- **Idempotencia**: cada migración se ejecuta una sola vez (trackeada en `__drizzle_migrations`). Si un archivo ya se aplicó, se salta.
- **Sin dependencia de drizzle-kit en runtime**: el `migrator` de `drizzle-orm` solo lee archivos `.sql` y los ejecuta. No necesita `drizzle-kit` (que pesa ~50 MB).

### 2.4 Mecanismo de espera + migraciones (entrypoint lógico)

Toda la lógica de startup reside en un bloque añadido al inicio de `main()` en `src/index.ts`. **No se añade un entrypoint.sh separado** porque:

1. La imagen actual es `oven/bun:1.2-slim` (Debian-based, sin bash ni pg_isready).
2. Un entrypoint en TypeScript es más mantenible y no requiere dependencias de sistema adicionales.
3. El health check del contenedor se maneja aumentando `--start-period` en lugar de complicar el entrypoint.

```typescript
// src/index.ts — bloque añadido al inicio de main()
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);

  // ─── PostgreSQL startup gate ──────────────────────────────
  if (config.sessionStore === 'postgres' && config.databaseUrl) {
    const { waitForPostgres, runMigrations } = await import('./storage/postgres-db');
    try {
      await waitForPostgres(config.databaseUrl, logger, 30_000); // max 30s
      await runMigrations(config.databaseUrl, logger);
    } catch (err) {
      logger.error('PostgreSQL startup failed', { error: String(err) });
      process.exit(1);
    }
  }

  // ... resto del bootstrap (eventBus, sessionStore, client, etc.)
}
```

**Secuencia de `waitForPostgres`**:
```
intento 1 → SELECT 1 → ❌ ECONNREFUSED → sleep 1s
intento 2 → SELECT 1 → ❌ ECONNREFUSED → sleep 1.5s
intento 3 → SELECT 1 → ❌ timeout       → sleep 2s
...
intento N → SELECT 1 → ✅ → salir
```

Timeout total configurable (default 30s). Si se agota, `process.exit(1)` con mensaje descriptivo.

**Secuencia de `runMigrations`**:
```
leer directorio migrations/ → filtrar *.sql
  → conectar a PostgreSQL
    → drizzle-orm/migrator: migrate(db, { migrationsFolder })
      → por cada .sql no aplicado: ejecutar en transacción, registrar en __drizzle_migrations
        → cerrar conexión de migración
```

### 2.5 Integración con Docker

#### Dockerfile (cambios mínimos)

```dockerfile
# ... stages deps y build sin cambios ...

# Stage 3: Runtime
FROM oven/bun:1.2-slim AS runtime
# ... copias existentes sin cambios ...

# NEW: Copiar archivos de migración SQL
COPY migrations/ ./migrations/

# MODIFIED: Aumentar start-period para acomodar espera de PostgreSQL
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:${HEALTH_PORT:-9877}/health || exit 1
```

**No se instala `postgresql-client` ni se añade `entrypoint.sh`.** La espera y migración ocurren dentro del proceso Bun.

#### docker-compose.yml (servicio postgres para desarrollo)

```yaml
services:
  # ... servicios existentes sin cambios ...

  postgres:
    image: postgres:16-alpine
    container_name: wacore-postgres
    environment:
      POSTGRES_USER: wacore
      POSTGRES_PASSWORD: wacore
      POSTGRES_DB: wacore
    volumes:
      - pg_data:/var/lib/postgresql/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wacore"]
      interval: 5s
      timeout: 3s
      retries: 5
    ports:
      - "5432:5432"

volumes:
  pg_data:
```

En el servicio `wacore` se añade:
```yaml
    environment:
      - DATABASE_URL=postgres://wacore:wacore@postgres:5432/wacore
    depends_on:
      postgres:
        condition: service_healthy
```

---

## 3. Diagrama de flujo del startup con PostgreSQL

```
┌─────────────────────────────────────────────────────────────────┐
│                    WACore Container Startup                      │
│                                                                  │
│  Docker ENTRYPOINT ["bun", "run", "src/index.ts"]                │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────────────┐                                        │
│  │ loadConfig()         │  Lee SESSION_STORE, DATABASE_URL       │
│  └──────────┬───────────┘                                        │
│             │                                                    │
│    ¿SESSION_STORE === 'postgres'?                                │
│         │                   │                                    │
│     SI  │                   │ NO                                 │
│         ▼                   ▼                                    │
│  ┌──────────────────┐   ┌──────────────────────┐                 │
│  │ waitForPostgres  │   │ Bootstrap normal     │                 │
│  │ (retry 30s max)  │   │ (sin espera DB)      │                 │
│  └────────┬─────────┘   └──────────────────────┘                 │
│           │                                                      │
│     ¿conexión OK?                                                │
│      │         │                                                 │
│    SI│         │ NO → exit(1)                                    │
│      ▼                                                           │
│  ┌──────────────────┐                                            │
│  │ runMigrations()  │  drizzle-orm/migrator ejecuta .sql         │
│  │ (idempotente)    │  pendientes contra __drizzle_migrations    │
│  └────────┬─────────┘                                            │
│           │                                                      │
│     ¿migraciones OK?                                             │
│      │         │                                                 │
│    SI│         │ NO → exit(1)                                    │
│      ▼                                                           │
│  ┌──────────────────────┐                                        │
│  │ Bootstrap normal     │  createSessionStore('postgres')        │
│  │ EventBus + Auth      │  createAuthProvider(postgresStore)     │
│  │ Client + Health      │  createBaileysClient(...)              │
│  │ API + Webhooks       │  ... resto del startup                 │
│  └──────────────────────┘                                        │
│                                                                  │
│  Container HEALTHY (GET /health → 200)                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Archivos a crear/modificar

### 4.1 Archivos nuevos

| Archivo | Propósito |
|---------|-----------|
| `src/storage/postgres-store.ts` | Clase `PostgresStore` — implementa `SessionStore` para PostgreSQL |
| `src/storage/postgres-db.ts` | Schema Drizzle, factory de conexión, `waitForPostgres()`, `runMigrations()` |
| `migrations/0000_initial.sql` | Migración inicial: crea tabla `wacore_sessions` |
| `drizzle.config.ts` | Configuración de drizzle-kit (solo para desarrollo) |

### 4.2 Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/storage/session-store.ts` | Añadir case `'postgres'` → `createPostgresStore()` con dynamic import |
| `src/types/index.ts` | Añadir `databaseUrl?: string` a `EnvConfig` |
| `src/config.ts` | Leer `DATABASE_URL` del entorno |
| `src/index.ts` | Bloque de startup gate para PG (wait + migrate) al inicio de `main()` |
| `package.json` | Añadir `drizzle-orm`, `postgres` como dependencies; `drizzle-kit` como devDependency |
| `Dockerfile` | `COPY migrations/ ./migrations/` + aumentar `--start-period=60s` |
| `docker-compose.yml` | Añadir servicio `postgres` + `DATABASE_URL` en wacore + `depends_on` |
| `.env.example` | Añadir `DATABASE_URL=postgres://...` |
| `tsconfig.json` | Sin cambios (ya tiene `strict: true`, `moduleResolution: bundler`) |

---

## 5. Plan de implementación por fases

### Fase 1: Dependencias y schema (20 min)

| # | Tarea | Detalle |
|---|-------|---------|
| 1.1 | Instalar dependencias | `bun add drizzle-orm postgres` + `bun add -d drizzle-kit` |
| 1.2 | Crear schema Drizzle | `src/storage/postgres-db.ts` con definición de tabla `wacore_sessions` |
| 1.3 | Configurar drizzle-kit | `drizzle.config.ts` apuntando al schema y `migrations/` |
| 1.4 | Generar migración inicial | `bunx drizzle-kit generate` → produce `migrations/0000_initial.sql` |
| 1.5 | Verificar archivo SQL generado | Revisar que el SQL sea correcto y no tenga referencias a extensiones innecesarias |

### Fase 2: PostgresStore (30 min)

| # | Tarea | Detalle |
|---|-------|---------|
| 2.1 | Implementar `PostgresStore` | `src/storage/postgres-store.ts` con los 5 métodos de `SessionStore` |
| 2.2 | `constructor()` | Recibe `config` y `logger`, crea pool de conexiones con `postgres` |
| 2.3 | `save(creds, keys)` | `INSERT ... ON CONFLICT DO UPDATE` con `BufferJSON.replacer` |
| 2.4 | `load()` | `SELECT creds, keys WHERE instance_name = $1` con `BufferJSON.reviver` |
| 2.5 | `delete()` | `DELETE WHERE instance_name = $1` |
| 2.6 | `exists()` | `SELECT 1 WHERE instance_name = $1 LIMIT 1` → `true/false` |
| 2.7 | `backup()` | No-op con log debug: "backup delegated to PostgreSQL admin" |
| 2.8 | `disconnect()` | Cerrar el pool con `await sql.end()` — llamado en shutdown |

### Fase 3: Startup gate (20 min)

| # | Tarea | Detalle |
|---|-------|---------|
| 3.1 | `waitForPostgres()` | Retry loop con backoff lineal (1s, 1.5s, 2s...) hasta timeout configurable |
| 3.2 | `runMigrations()` | Usa `drizzle-orm/postgres-js/migrator` → `migrate(db, { migrationsFolder })` |
| 3.3 | `createConnection()` | Factory que devuelve una instancia `postgres` + drizzle wrapper |
| 3.4 | Integrar en `src/index.ts` | Bloque `if (config.sessionStore === 'postgres')` al inicio de `main()` |
| 3.5 | Integrar en `session-store.ts` | Añadir case `'postgres'` con dynamic import de `PostgresStore` |

### Fase 4: Tipos y configuración (10 min)

| # | Tarea | Detalle |
|---|-------|---------|
| 4.1 | `EnvConfig.databaseUrl` | Añadir campo opcional `databaseUrl?: string` en `src/types/index.ts` |
| 4.2 | `config.ts` | Leer `Bun.env.DATABASE_URL` |
| 4.3 | `.env.example` | Añadir `DATABASE_URL=postgres://wacore:wacore@localhost:5432/wacore` |

### Fase 5: Docker e infraestructura (15 min)

| # | Tarea | Detalle |
|---|-------|---------|
| 5.1 | `Dockerfile` | `COPY migrations/ ./migrations/` + `--start-period=60s` |
| 5.2 | `docker-compose.yml` | Servicio `postgres:16-alpine` + `DATABASE_URL` en `wacore` + `depends_on` |
| 5.3 | `.dockerignore` | Verificar que `node_modules/` y `drizzle.config.ts` estén ignorados (ya deberían) |

### Fase 6: Tests (20 min)

| # | Tarea | Detalle |
|---|-------|---------|
| 6.1 | Test `waitForPostgres` | Mock del driver, simular fallos + éxito |
| 6.2 | Test `runMigrations` | Mock de `migrate()`, verificar que se llama con el folder correcto |
| 6.3 | Test `PostgresStore` unitario | Mock de `postgres`, verificar queries generadas |
| 6.4 | Test de integración | Con PostgreSQL real (via `docker compose up postgres`), probar save/load/delete cycle |
| 6.5 | Test de serialización Buffer | Verificar que `BufferJSON.replacer/reviver` funciona con JSONB |

### Fase 7: Documentación y cleanup (10 min)

| # | Tarea | Detalle |
|---|-------|---------|
| 7.1 | Actualizar `AGENTS.md` | Añadir referencia a PostgreSQL como session store soportado |
| 7.2 | `bun test` | Todos los tests existentes deben seguir pasando (sin regresiones en file/redis) |
| 7.3 | `tsc --noEmit` | 0 errores de tipo |
| 7.4 | Actualizar `progress/tasks.md` | Marcar RF-05 como `planned` tras aprobación del diseño |

---

## 6. Consideraciones detalladas

### 6.1 Serialización de Buffers

Baileys usa `BufferJSON.replacer` para serializar `Buffer` a `{type: "Buffer", data: [104, 101, 108, ...]}`. PostgreSQL almacena este objeto JSON nativamente como JSONB. Al recuperar, `BufferJSON.reviver` reconstruye los Buffers. Este mecanismo es **exactamente el mismo** que usan `FileStore` (con `JSON.stringify(creds, BufferJSON.replacer)`) y `RedisStore`. **No se requiere lógica adicional.**

```typescript
// save: igual que los otros stores
const credsJson = JSON.stringify(creds, BufferJSON.replacer);
await sql`INSERT INTO wacore_sessions ... ${credsJson}`;

// load: igual que los otros stores
const row = await sql`SELECT creds, keys ...`;
const creds = JSON.parse(row.creds, BufferJSON.reviver);
```

### 6.2 Pool de conexiones

El driver `postgres` (porsager) crea un pool de **10 conexiones por defecto**. Para un session store que solo hace queries ocasionales (al iniciar, al guardar credenciales periódicamente), esto es excesivo. Se configura `max: 3` para limitar el pool:

```typescript
const sql = postgres(databaseUrl, {
  max: 3,
  idle_timeout: 30,
  connect_timeout: 10,
});
```

Esto es suficiente para el patrón de acceso del session store y respeta los recursos de la base de datos.

### 6.3 Manejo de errores

| Escenario | Comportamiento |
|-----------|---------------|
| PostgreSQL no disponible al arrancar | `waitForPostgres` reintenta hasta 30s, luego `process.exit(1)` |
| Migración falla (SQL inválido) | `runMigrations` captura error, loguea, `process.exit(1)` |
| Conexión perdida durante operación normal | El driver `postgres` reconecta automáticamente. La operación fallida se loguea como error. |
| `save()` falla (DB caída en runtime) | Error logueado, auth no persiste. En la siguiente iteración de save (Baileys llama periódicamente) reintentará. |
| `load()` falla | Retorna `null` → Baileys genera credenciales frescas (requiere re-escanear QR). |
| Sesión corrupta en JSONB | `load()` captura `JSON.parse` error, retorna `null`, loguea warning. |
| `DATABASE_URL` no configurada pero `SESSION_STORE=postgres` | `loadConfig` loguea warning, el startup gate hace `exit(1)` con mensaje descriptivo. |
| Múltiples instancias con igual `instance_name` | El `ON CONFLICT` en `save()` sobrescribe. Esto es un error de configuración del operador (dos containers con misma `WA_INSTANCE_NAME` no deben coexistir). |

### 6.4 Tamaño de la imagen Docker

Análisis del impacto:

| Componente | Peso aprox (gzip) | ¿En producción? |
|-----------|-------------------|-----------------|
| `drizzle-orm` | ~51 kB | ✅ Sí |
| `postgres` (porsager) | ~50 kB | ✅ Sí |
| `drizzle-kit` | ~50 MB | ❌ No (devDependency) |
| `migrations/*.sql` | <1 kB | ✅ Sí |
| **Total añadido** | **~101 kB** | |

La imagen actual de runtime (`oven/bun:1.2-slim`) pesa ~150 MB. Añadir 100 kB es **imperceptible**. El diseño cumple el requisito de "imagen ligera".

### 6.5 `DATABASE_URL` como variable de entorno

Formato estándar de PostgreSQL connection string:
```
DATABASE_URL=postgres://user:password@host:port/database
```

Con SSL:
```
DATABASE_URL=postgres://user:password@host:5432/database?sslmode=require
```

El driver `postgres` soporta nativamente este formato (URI-compatible con `libpq`). No se requiere parseo adicional.

### 6.6 Compatibilidad con stores existentes

- **FileStore**: sin cambios. `SESSION_STORE=file` sigue funcionando igual.
- **RedisStore**: sin cambios. `SESSION_STORE=redis` sigue funcionando igual.
- La factory en `session-store.ts` añade un nuevo `case 'postgres'` mediante dynamic import, igual que los otros.
- Si no se configura `DATABASE_URL` y el store es `postgres`, el startup gate produce un error claro.
- El `default` del switch sigue siendo `file` para valores desconocidos.

### 6.7 Uso como imagen base por otros proyectos

Cuando otro proyecto usa la imagen WACore, simplemente debe:
1. Proveer una base de datos PostgreSQL (propia o gestionada).
2. Pasar `DATABASE_URL` como variable de entorno.
3. Configurar `SESSION_STORE=postgres`.

WACore se encarga del resto:
- Espera a que la DB esté lista.
- Crea la tabla `wacore_sessions` automáticamente (vía migraciones).
- No requiere que el proyecto consumidor ejecute migraciones manualmente.

---

## 7. Edge cases

### 7.1 Migraciones idempotentes

Cada archivo `.sql` en `migrations/` tiene un hash que se registra en `__drizzle_migrations`. Si el contenedor se reinicia, `drizzle-orm/migrator` consulta esta tabla y salta los archivos ya aplicados. Ejecutar migraciones múltiples veces es seguro.

Si se añaden nuevas migraciones en una versión futura de WACore, solo se ejecutan las no aplicadas.

### 7.2 PostgreSQL no disponible al arrancar (retry con backoff)

```
Intento 1 → delay 0ms   → SELECT 1 → ❌
Intento 2 → delay 1000ms  → SELECT 1 → ❌
Intento 3 → delay 1500ms  → SELECT 1 → ❌
Intento 4 → delay 2250ms  → SELECT 1 → ❌
...
Timeout tras 30s → exit(1)
```

El backoff es **lineal incrementado en 50% cada intento** (no exponencial) porque el startup de PostgreSQL en un contenedor típico tarda 5-15 segundos. Un backoff exponencial alargaría innecesariamente el tiempo total.

### 7.3 Actualización de esquema entre versiones

Cuando WACore publique una nueva versión con un schema modificado:
1. El desarrollador modifica `src/storage/postgres-db.ts` (schema Drizzle).
2. Ejecuta `bunx drizzle-kit generate` → crea `migrations/0001_add_column.sql`.
3. Commitea el nuevo archivo `.sql`.
4. La nueva imagen Docker incluye `migrations/0001_add_column.sql`.
5. Al arrancar, `runMigrations()` detecta que `0001_add_column.sql` no se ha aplicado y la ejecuta.

**No se requiere intervención del operador.**

### 7.4 Rollback de migraciones

Drizzle no soporta rollback automático. Si una migración falla:
- La transacción se revierte automáticamente (el migrator de Drizzle ejecuta cada archivo SQL en una transacción).
- El contenedor hace `exit(1)`.
- El operador debe investigar y potencialmente restaurar un backup de PostgreSQL.

Para migraciones no destructivas (solo `ALTER TABLE ADD COLUMN`, nunca `DROP`), el riesgo es mínimo. Se recomienda que las migraciones sigan el principio de **solo añadir, nunca eliminar** columnas sin un período de gracia.

### 7.5 Sesión corrupta en DB

Si los datos JSONB en la columna `creds` o `keys` están corruptos (por ejemplo, un guardado parcial debido a un crash), `JSON.parse` fallará al cargar. El comportamiento:

```typescript
try {
  const creds = JSON.parse(row.creds, BufferJSON.reviver);
} catch {
  logger.warn('Session data corrupted in PostgreSQL, generating fresh credentials');
  return null; // Baileys genera credenciales nuevas → requiere QR
}
```

Esto es equivalente al comportamiento de `FileStore` (que intenta restoreFromBackup) y `RedisStore` (que retorna null). Para PostgreSQL, no implementamos backup automático porque la DB ya es redundante (el operador debe tener su propia estrategia de backup: replicación, WAL archiving, pg_dump).

### 7.6 Múltiples instancias en la misma DB

Diferentes instancias de WACore (con distinto `WA_INSTANCE_NAME`) coexisten sin conflicto porque `instance_name` es la PK. La tabla se vería así:

```
 instance_name | creds (JSONB) | keys (JSONB) | created_at | updated_at
---------------+---------------+--------------+------------+------------
 bot-prod      | {...}         | {...}        | ...        | ...
 bot-staging   | {...}         | {...}        | ...        | ...
 bot-dev       | {...}         | {...}        | ...        | ...
```

Dos containers con el **mismo** `WA_INSTANCE_NAME` apuntando a la misma DB **no deben coexistir** (se pisarían las credenciales mutuamente). Esto es un error de despliegue, no un edge case del software. Se documenta en el README.

### 7.7 Conexión SSL/TLS

Si `DATABASE_URL` incluye `?sslmode=require` (o `sslmode=verify-full`), el driver `postgres` negocia TLS automáticamente. No se requiere configuración adicional de certificados a menos que se use `sslmode=verify-full` con CA custom (en cuyo caso se usaría `?sslcert=...` en la URL o variables de entorno `PGSSLCERT`, `PGSSLKEY`, `PGSSLROOTCERT`).

---

## 8. Criterios de aceptación

- [ ] `bun run src/index.ts` con `SESSION_STORE=postgres` y PostgreSQL disponible arranca correctamente.
- [ ] Las migraciones se ejecutan automáticamente al arrancar (tabla `wacore_sessions` se crea sin intervención).
- [ ] Segundo arranque: las migraciones no se re-ejecutan (idempotencia).
- [ ] `PostgresStore.save()` persiste credenciales y `load()` las recupera con Buffers correctamente reconstruidos.
- [ ] `PostgresStore.delete()` elimina la fila, `exists()` retorna `false`.
- [ ] `PostgresStore.backup()` es un no-op que no lanza errores.
- [ ] Si PostgreSQL no está disponible al arrancar, el contenedor reintenta y eventualmente sale con error descriptivo tras timeout.
- [ ] `bun test` — todos los tests existentes pasan sin regresiones (file-store, redis-store, etc.).
- [ ] `tsc --noEmit` — 0 errores.
- [ ] `docker compose up` con `SESSION_STORE=postgres` funciona (requiere servicio `postgres` en compose).
- [ ] La imagen Docker no incluye `drizzle-kit` (solo `drizzle-orm` y `postgres`).
- [ ] `DATABASE_URL` no se hardcodea ni aparece en la imagen (solo como variable de entorno).
- [ ] El `HEALTHCHECK` del Dockerfile permite suficiente `start-period` para la espera de PostgreSQL.
- [ ] `.env.example` incluye `DATABASE_URL` con un ejemplo comentado.

---

> **Próximo paso:** Una vez aprobado este diseño, @developer implementa en el orden especificado en la Fase 1 → Fase 7.
