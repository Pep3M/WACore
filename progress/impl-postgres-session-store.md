# Implementación — RF-05: PostgreSQL Session Store

> **Versión:** 1.0
> **Fecha:** 2026-05-08
> **Estado:** Done
> **Implementador:** @developer

---

## Resumen

Se implementó el tercer backend de persistencia para sesiones de WhatsApp: PostgreSQL, usando Drizzle ORM + driver `postgres` (porsager). La implementación sigue fielmente el diseño del arquitecto.

## Archivos creados

| Archivo | Líneas | Propósito |
|---------|--------|-----------|
| `src/storage/postgres-db.ts` | ~90 | Schema Drizzle, waitForPostgres, runMigrations, createConnection |
| `src/storage/postgres-store.ts` | ~115 | PostgresStore (implementa SessionStore) |
| `drizzle.config.ts` | ~8 | Configuración de drizzle-kit |
| `migrations/0000_nappy_matthew_murdock.sql` | ~7 | Migración inicial: CREATE TABLE wacore_sessions |
| `migrations/meta/0000_snapshot.json` | — | Snapshot Drizzle para tracking |
| `migrations/meta/_journal.json` | — | Journal de migraciones |
| `src/__tests__/postgres-store.test.ts` | ~270 | Tests unitarios con mocks |

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `package.json` | +drizzle-orm, +postgres (deps), +drizzle-kit (devDep) |
| `src/types/index.ts` | +databaseUrl?: string en EnvConfig |
| `src/config.ts` | Lectura de DATABASE_URL |
| `src/storage/session-store.ts` | +case 'postgres' + createPostgresStore() |
| `src/index.ts` | PostgreSQL startup gate (wait + migrate) |
| `Dockerfile` | COPY migrations/ + --start-period=60s |
| `docker-compose.yml` | +servicio postgres, +DATABASE_URL, +depends_on |
| `.env.example` | +DATABASE_URL comentado |

## Resultados de verificación

- **Typecheck:** `tsc --noEmit` → 0 errores ✅
- **Tests:** `bun test` → 199 pass, 0 fail, 388 expect() calls ✅
- **Lint:** No se introdujeron nuevos errores (no hay linter configurado aparte de TS)

## Desviaciones del diseño

Ninguna desviación significativa. Detalles menores:

1. **Naming de migración**: Drizzle-kit generó `0000_nappy_matthew_murdock.sql` en vez de `0000_initial.sql` (naming automático de drizzle-kit).
2. **BufferJSON**: Se descubrió que el `BufferJSON` de baileys usa base64 para `data` (no array de números). Los tests se ajustaron para reflejar el formato real `{type: "Buffer", data: "base64string"}`.
3. **Pool de conexiones**: En `waitForPostgres` se usa `max: 1` para la conexión de prueba, mientras que `createConnection` usa `max: 3` como especifica el diseño.
