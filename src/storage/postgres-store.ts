import { BufferJSON } from 'baileys/lib/Utils/generics.js';
import postgres from 'postgres';
import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from './session-store';
import type { SessionRow } from '../sessions/types';
import { createConnection } from './postgres-db';

let conexionesCorrompidas = 0;

/** Cuántas veces se ha visto romperse una conexión del pool. Lo lee `/health`. */
export function contadorConexionesCorrompidas(): number {
  return conexionesCorrompidas;
}

/** Solo para los tests: deja el contador a cero entre casos. */
export function reiniciarContadorConexionesCorrompidas(): void {
  conexionesCorrompidas = 0;
}

/**
 * ¿Este fallo dejó la conexión inservible, o solo se cayó la consulta?
 *
 * Un error **de Postgres** trae su SQLSTATE de cinco caracteres (`23505` clave duplicada, `57014`
 * plazo agotado) y no tiene nada de raro: la conexión sigue sana y la siguiente consulta funciona.
 *
 * Un error **del driver** es otra cosa. Si `postgres-js` revienta serializando un parámetro —el
 * caso real fue `TypeError: The "string" argument must be of type string… Received an instance of
 * Date`—, revienta **a mitad de escribir el mensaje en el socket**. Postgres se queda esperando el
 * resto y la conexión no vuelve a servir para nada, pero regresa al pool como si tal cosa.
 *
 * Distinguirlos es lo que separa «se ha caído una consulta» de «hemos perdido un décimo del pool y
 * nadie se ha enterado».
 */
export function esConexionCorrompida(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const code = (err as { code?: unknown }).code;

  // SQLSTATE: cinco caracteres alfanuméricos en mayúsculas. Es Postgres hablando, no el driver.
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return false;

  if (err instanceof TypeError) return true;

  // Los errores de Node (`ERR_INVALID_ARG_TYPE` y compañía) salen del propio serializador.
  return typeof code === 'string' && code.startsWith('ERR_');
}

/**
 * Registra un fallo de la base **y** lo clasifica.
 *
 * El mensaje de siempre se conserva para no romper lo que ya lo busque en los registros; la
 * conexión corrompida añade el suyo, que dice lo que de verdad ha pasado.
 */
function registrarFallo(logger: Logger, mensaje: string, err: unknown): void {
  if (esConexionCorrompida(err)) {
    conexionesCorrompidas++;
    logger.error('Conexión de Postgres corrompida: el driver falló a media escritura', {
      operacion: mensaje,
      error: String(err),
      total: conexionesCorrompidas,
    });
    return;
  }

  logger.error(mensaje, { error: String(err) });
}

export class PostgresStore implements SessionStore {
  private sql: postgres.Sql;
  private instanceName: string;
  private logger: Logger;

  constructor(config: EnvConfig, logger: Logger, options?: { sharedSql?: postgres.Sql; instanceName?: string }) {
    this.instanceName = options?.instanceName ?? config.instanceName;
    this.logger = logger;

    if (options?.sharedSql) {
      this.sql = options.sharedSql;
    } else {
      const databaseUrl = config.databaseUrl;
      if (!databaseUrl) {
        throw new Error('DATABASE_URL is required for postgres session store');
      }
      const conn = createConnection(databaseUrl);
      this.sql = conn.sql;
    }
  }

  async exists(): Promise<boolean> {
    try {
      const rows = await this.sql`
        SELECT 1 FROM wacore_sessions WHERE instance_name = ${this.instanceName} LIMIT 1
      `;
      return rows.length > 0;
    } catch (err) {
      registrarFallo(this.logger, 'Failed to check session existence in PostgreSQL', err);
      return false;
    }
  }

  async load(): Promise<{ creds: unknown; keys: unknown } | null> {
    try {
      const rows = await this.sql<
        Array<{ creds: unknown; keys: unknown }>
      >`
        SELECT creds, keys FROM wacore_sessions WHERE instance_name = ${this.instanceName}
      `;
      if (rows.length === 0) {
        this.logger.debug('No session data found in PostgreSQL');
        return null;
      }
      const row = rows[0] as { creds: string; keys: string };
      const rawCreds = typeof row.creds === 'string' ? row.creds : JSON.stringify(row.creds);
      if (rawCreds === '{}' || rawCreds === 'null') {
        this.logger.info('Session row exists but creds are empty, generating fresh credentials');
        return null;
      }
      const creds = JSON.parse(rawCreds, BufferJSON.reviver);
      const keys = JSON.parse(
        typeof row.keys === 'string' ? row.keys : JSON.stringify(row.keys),
        BufferJSON.reviver,
      );
      this.logger.info('Session loaded from PostgreSQL');
      return { creds, keys };
    } catch (err) {
      registrarFallo(this.logger, 'Failed to load session from PostgreSQL', err);
      return null;
    }
  }

  async save(creds: unknown, keys: unknown): Promise<void> {
    try {
      const credsJson = JSON.stringify(creds, BufferJSON.replacer);
      const keysJson = JSON.stringify(keys, BufferJSON.replacer);
      await this.sql`
        INSERT INTO wacore_sessions (instance_name, creds, keys, created_at, updated_at)
        VALUES (
          ${this.instanceName},
          ${credsJson}::jsonb,
          ${keysJson}::jsonb,
          NOW(),
          NOW()
        )
        ON CONFLICT (instance_name)
        DO UPDATE SET
          creds = ${credsJson}::jsonb,
          keys = ${keysJson}::jsonb,
          updated_at = NOW()
      `;
      this.logger.debug('Session saved to PostgreSQL');
    } catch (err) {
      registrarFallo(this.logger, 'Failed to save session to PostgreSQL', err);
    }
  }

  async delete(): Promise<void> {
    try {
      await this.sql`
        DELETE FROM wacore_sessions WHERE instance_name = ${this.instanceName}
      `;
      this.logger.warn('Session deleted from PostgreSQL');
    } catch (err) {
      // No se propaga a propósito. El único que llama aquí es `client.logout()`, y desde ahí un
      // error subiría hasta `POST /whatsapp/connections/:id/logout` y lo convertiría en un 500:
      // no poder borrar la fila no es motivo para decirle a nadie que no se ha desconectado.
      // Lo que sí cambia es que una conexión corrompida ya no pasa por un aviso más del montón.
      registrarFallo(this.logger, 'Failed to delete session from PostgreSQL', err);
    }
  }

  async backup(): Promise<void> {
    this.logger.debug('Backup delegated to PostgreSQL admin');
  }

  async disconnect(): Promise<void> {
    try {
      await this.sql.end();
    } catch {
      // Connection already closed
    }
  }
}

// ─── Pool-level registry for multi-session operations ──────────────────────────

export type SessionMetaUpdate = {
  status?: string;
  phoneNumber?: string | null;
  displayName?: string | null;
  lastSeenAt?: Date;
};

export class PostgresSessionRegistry {
  constructor(private readonly sql: postgres.Sql) {}

  async list(): Promise<SessionRow[]> {
    const rows = await this.sql<Array<{
      instance_name: string;
      account_id: string | null;
      user_id: string | null;
      display_name: string | null;
      phone_number: string | null;
      status: string;
      last_seen_at: Date | null;
    }>>`
      SELECT instance_name, account_id, user_id, display_name, phone_number, status, last_seen_at
      FROM wacore_sessions
      ORDER BY instance_name
    `;
    return rows.map(r => ({
      instanceName: r.instance_name,
      accountId: r.account_id,
      userId: r.user_id,
      displayName: r.display_name,
      phoneNumber: r.phone_number,
      status: (r.status || 'disconnected') as SessionRow['status'],
      lastSeenAt: r.last_seen_at,
    }));
  }

  /**
   * Deja la fila de la sesión creada y **con su dueño**.
   *
   * Estuvo con `DO NOTHING`, y eso dejaba una avería que solo aparecía al reiniciar: quien crea
   * la fila primero no siempre es este método. `save()` la inserta cada vez que Baileys guarda
   * credenciales y lo hace **sin `account_id` ni `user_id`**, así que en cuanto ganaba esa
   * carrera el dueño se quedaba nulo para siempre.
   *
   * Mientras WACore no se reiniciara no se notaba: la sesión viva en memoria sí sabía de quién
   * era. Al reiniciar, `bootstrap()` la reconstruía leyendo esta fila, la sesión nacía sin dueño
   * y **todas las peticiones del consumidor se iban en 403** («Session does not belong to the
   * authenticated tenant»). Desde fuera se ve como «WACore no responde», que no lleva a ninguna
   * parte.
   *
   * `COALESCE` y no una asignación directa: rellena lo que falta y **nunca cambia un dueño que
   * ya esté puesto**. Sobrescribirlo sería mover la línea de una cuenta a otra desde una llamada
   * cualquiera.
   */
  async ensureRow(sessionId: string, accountId: string | null, userId: string | null): Promise<void> {
    await this.sql`
      INSERT INTO wacore_sessions (instance_name, creds, keys, account_id, user_id, status, created_at, updated_at)
      VALUES (
        ${sessionId},
        '{}'::jsonb,
        '{}'::jsonb,
        ${accountId},
        ${userId},
        'disconnected',
        NOW(),
        NOW()
      )
      ON CONFLICT (instance_name) DO UPDATE SET
        account_id = COALESCE(wacore_sessions.account_id, EXCLUDED.account_id),
        user_id    = COALESCE(wacore_sessions.user_id, EXCLUDED.user_id),
        updated_at = NOW()
    `;
  }

  /**
   * La fecha se convierte a texto **aquí y a mano**, en lugar de entregarle un `Date` al driver.
   *
   * No es estilo: era el único parámetro no primitivo que salía por el pool de sesiones, y el
   * serializador de `postgres-js` es donde reventó la avería que dejó a WACore sin generar códigos
   * QR. Cuando ese serializador falla, falla **a mitad de escribir el mensaje en el socket**:
   * Postgres se queda esperando el resto, la conexión queda inservible y vuelve al pool como si
   * nada. Con `max: 3`, tres veces y no queda base de datos.
   *
   * Un `::timestamptz` sobre un ISO 8601 le da a Postgres exactamente el mismo valor —la conversión
   * la hace él, que es quien sabe— y el driver solo ve una cadena, que no puede romper.
   *
   * Es el mismo remedio que ya se aplicó en el buzón de salida por exactamente el mismo error;
   * ver el comentario de `PostgresOutboxStore.purge()`, donde el `Date` sin convertir tiraba el
   * ciclo de purga entero.
   */
  async updateStatus(sessionId: string, meta: SessionMetaUpdate): Promise<void> {
    const marca = (meta.lastSeenAt ?? new Date()).toISOString();
    await this.sql`
      UPDATE wacore_sessions SET
        status = COALESCE(${meta.status ?? null}, status),
        phone_number = COALESCE(${meta.phoneNumber ?? null}, phone_number),
        display_name = COALESCE(${meta.displayName ?? null}, display_name),
        last_seen_at = ${marca}::timestamptz,
        updated_at = NOW()
      WHERE instance_name = ${sessionId}
    `;
  }

  async deleteRow(sessionId: string): Promise<void> {
    await this.sql`DELETE FROM wacore_sessions WHERE instance_name = ${sessionId}`;
  }
}
