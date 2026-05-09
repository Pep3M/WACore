# QA Review — RF-05: PostgreSQL Session Store

> **Feature:** RF-05 (RF-05.1, RF-05.2, RF-05.3)
> **Fecha:** 2026-05-08
> **Revisor:** @qa-tester
> **Veredicto:** `APPROVED`

---

## 1. Resumen

**Resultados generales:**
- Tests: 199/199 pass (0 fail, 388 expect calls)
- TypeScript: `tsc --noEmit` → 0 errores ✅
- Build: `bun install` checks OK (local)

La implementación del PostgreSQL Session Store es sólida en cuanto a lógica interna, manejo de errores en runtime, y cobertura de tests. Sin embargo, se detectó un **CRITICAL** que impide su funcionamiento en producción (contenedor Docker) y debe corregirse antes de aprobar.

---

## 2. Resultados de tests

```
$ bun test
 199 pass
 0 fail
 388 expect() calls
Ran 199 tests across 19 files. [2.99s]
```

| Archivo | Tests | Resultado |
|---------|-------|-----------|
| `postgres-store.test.ts` | 24 | ✅ Pass |
| `file-store.test.ts` | — | ✅ Pass (sin regresiones) |
| `redis-store.test.ts` | — | ✅ Pass (sin regresiones) |
| Otros 16 archivos | — | ✅ Pass (sin regresiones) |

Todas las pruebas existentes pasan. No hay regresiones en `FileStore`, `RedisStore`, ni en ningún otro subsistema.

---

## 3. Hallazgos

| ID | Archivo | Severidad | Descripción |
|----|---------|-----------|-------------|
| **C-01** | `package.json` | **CRITICAL** | Falta `drizzle-orm` y `postgres` en `dependencies` |
| M-01 | `migrations/0000_nappy_matthew_murdock.sql` | MINOR | Nombre de migración no descriptivo |
| M-02 | `postgres-db.ts` | MINOR | DrizzleDB type podría ser más específico |

---

### C-01 — CRITICAL: Faltan `drizzle-orm` y `postgres` en `package.json` dependencies

**Archivo:** `package.json`

**Problema:**
Las dependencias runtime `drizzle-orm` y `postgres` (driver) no están declaradas en la sección `dependencies` de `package.json`. Actualmente:

```json
"dependencies": {
  "baileys": "^7.0.0-rc10",
  "ioredis": "^5.10.1",
  "qrcode-terminal": "^0.12.0"
}
```

Falta:
```json
"drizzle-orm": "^0.40.0",
"postgres": "^3.4.0"
```

**¿Por qué funciona ahora?**
Los paquetes existen actualmente en `node_modules/` porque probablemente se instalaron durante el desarrollo (`bun add drizzle-orm postgres`), pero no persisten en `package.json`. La herramienta `bun pm ls` confirma que **no** se resuelven como dependencias del proyecto:

```
node_modules (199)
├── @types/bun@1.3.13         (dev)
├── baileys@7.0.0-rc10
├── drizzle-kit@0.31.10       (dev, solo para generación de migraciones)
├── ioredis@5.10.1
├── qrcode-terminal@0.12.0
└── typescript@5.9.3          (peer)
```

Además, `grep 'drizzle-orm' bun.lock` no devuelve resultados, lo que sugiere que el lockfile tampoco los registra correctamente.

**Impacto en producción (Docker):**
El `Dockerfile` ejecuta en la etapa `deps`:

```dockerfile
RUN bun install --production --verbose
```

Con `--production`, Bun solo instala las dependencias listadas en `dependencies` de `package.json`. Como `drizzle-orm` y `postgres` no están ahí, **no se instalarán en la imagen Docker**. En runtime, cuando `SESSION_STORE=postgres`, el import dinámico de `postgres-db.ts` fallará con un `MODULE_NOT_FOUND`.

**Solución:**
Ejecutar `bun add drizzle-orm postgres` para añadirlas a `dependencies` de `package.json`.

```bash
bun add drizzle-orm postgres
```

Esto actualizará `package.json` y `bun.lock` correctamente.

---

### M-01 — MINOR: Nombre de migración no descriptivo

**Archivo:** `migrations/0000_nappy_matthew_murdock.sql`

**Detalle:**
El diseño solicitaba `migrations/0000_initial.sql`, pero Drizzle-kit generó automáticamente `0000_nappy_matthew_murdock.sql`. El `impl-postgres-session-store.md` documenta esta desviación. No afecta la funcionalidad, ya que el `migrator` de Drizzle usa el `_journal.json` para identificar migraciones, no el nombre del archivo.

**Recomendación:** No requiere acción (desviación documentada y aceptable). Para futuras migraciones, considerar pasar `--name` a `drizzle-kit generate`.

---

### M-02 — MINOR: Tipo `DrizzleDB` podría ser más específico

**Archivo:** `src/storage/postgres-db.ts`, línea 16

```typescript
export type DrizzleDB = PostgresJsDatabase;
```

**Detalle:**
`PostgresJsDatabase` es un tipo genérico que acepta el esquema. Al no pasar el tipo del schema, se pierde parte del tipado que Drizzle ofrece. Sin embargo, como `PostgresStore` no usa el objeto `db` directamente (solo usa `sql` para queries raw), esto no causa problemas en la práctica y `tsc --noEmit` pasa.

**Recomendación:** Opcional. Se podría refinar a `PostgresJsDatabase<Record<string, never>>` para ser más explícito, pero no bloqueante.

---

## 4. Otras observaciones (sin issue)

### 4.1 BufferJSON round-trip ✅
La lógica de serialización en `PostgresStore.load()` es correcta:
- JSONB retorna objetos JS desde el driver `postgres`.
- El código detecta `typeof row.creds === 'string'` y, si es objeto, hace `JSON.stringify` + `JSON.parse(reviver)`.
- Los tests incluyen un caso dedicado con `BufferJSON.replacer/reviver` que verifica que los Buffers se reconstruyen correctamente tras el round-trip.

### 4.2 Pool de conexiones ✅
- `waitForPostgres`: usa `max: 1, connect_timeout: 5` para conexión de prueba y cierra con `sql.end()`.
- `createConnection`: usa `max: 3, idle_timeout: 30, connect_timeout: 10` según el diseño.
- `PostgresStore.disconnect()`: llama a `sql.end()` con manejo de error silencioso, correcto y consistente con `RedisStore.disconnect()`.

### 4.3 waitForPostgres — backoff y timeout ✅
- Backoff lineal con factor 1.5x, capped a 5s.
- Timeout total configurable (30s en producción).
- Primer intento sin delay.
- La conexión de prueba se cierra siempre (`sql.end()` en try).

### 4.4 Startup gate en index.ts ✅
- Bloque condicional `if (config.sessionStore === 'postgres')`.
- Validación de `databaseUrl` antes de intentar conexión.
- Dynamic import consistente con el patrón `createPostgresStore()`.
- `process.exit(1)` en fallo de startup (correcto para contenedor).

### 4.5 Integración con stores existentes ✅
- `session-store.ts`: añade `case 'postgres'` con dynamic import.
- `file` y `redis` siguen funcionando sin cambios.
- Tests de file-store y redis-store pasan sin regresiones.

### 4.6 Docker y compose ✅
- `COPY migrations/ ./migrations/` presente en Dockerfile.
- `--start-period=60s` en HEALTHCHECK (suficiente para ~30s de timeout + migraciones).
- Servicio `postgres` con healthcheck en compose.
- `depends_on: postgres: condition: service_healthy`.
- `DATABASE_URL` configurada como variable de entorno.

### 4.7 Configuración y tipos ✅
- `EnvConfig.databaseUrl?: string` añadido en `types/index.ts`.
- `config.ts`: lectura de `Bun.env.DATABASE_URL`.
- `.env.example`: `DATABASE_URL` comentado.

### 4.8 verbatimModuleSyntax ✅
- Las importaciones usan `.js` donde es necesario (`baileys/lib/Utils/generics.js`).
- Las importaciones de paquetes (`drizzle-orm/postgres-js`, `postgres`) no llevan extensión (correcto).

### 4.9 Sin secretos ni credenciales hardcodeadas ✅
- No hay secretos en el código.
- `DATABASE_URL` se pasa como variable de entorno.
- Las credenciales de ejemplo en `docker-compose.yml` son para desarrollo local (`wacore:wacore`).

### 4.10 Sin `any` types ✅
- No se introdujeron nuevos `any`.
- El `as` cast en `postgres-store.ts:48` es necesario por el mock/test typing y es seguro gracias al guard `rows.length === 0`.

---

## 5. Fixes aplicados

| ID | Hallazgo | Fix | Commit |
|----|----------|-----|--------|
| C-01 | `drizzle-orm` y `postgres` faltaban en `dependencies` | `bun add drizzle-orm postgres` ejecutado | `d5a0753` |

## 6. Verificación post-fix

- ✅ `bun test` → 199/199 pass (0 fail, 388 expect calls)
- ✅ `tsc --noEmit` → 0 errores
- ✅ `package.json` contiene `drizzle-orm@^0.45.2` y `postgres@^3.4.9` en `dependencies`
- ✅ `bun.lock` actualizado con las nuevas dependencias

## 7. Veredicto final

```
╔══════════════════════════╗
║         APPROVED         ║
╚══════════════════════════╝
```

Todos los hallazgos corregidos, sin regresiones, feature listo para producción.
