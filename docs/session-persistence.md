# Persistencia de sesión

WACore guarda las credenciales de autenticación de WhatsApp para no requerir escanear el QR en cada reinicio. Soporta tres backends:

## File

```env
SESSION_STORE=file
SESSION_DIR=/data/sessions
```

Guarda `creds.json` y `keys.json` en el directorio configurado. Incluye backups rotativos (`creds.json.bak.1`, `.bak.2`, `.bak.3`).

> ⚠️ En Docker, asegúrate de montar un volumen persistente en `SESSION_DIR` o perderás la sesión al recrear el contenedor.

## Redis

```env
SESSION_STORE=redis
REDIS_URL=redis://redis:6379
```

Las claves se almacenan como:
- `wacore:session:{instance}:creds`
- `wacore:session:{instance}:keys`

## PostgreSQL

```env
SESSION_STORE=postgres
DATABASE_URL=postgres://user:pass@host:5432/db
```

Las migraciones se ejecutan **automáticamente** al arrancar. No necesitas correr nada manual.

Esquema de la tabla (`wacore_sessions`):

```sql
CREATE TABLE IF NOT EXISTS wacore_sessions (
    instance_name TEXT PRIMARY KEY,
    creds         JSONB NOT NULL,
    keys          JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

> Múltiples instancias de WACore (distinto `WA_INSTANCE_NAME`) pueden compartir la misma base de datos PostgreSQL sin conflictos.
