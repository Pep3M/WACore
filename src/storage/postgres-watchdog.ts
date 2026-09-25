import postgres from 'postgres';
import type { Logger } from '../utils/logger';

/**
 * El vigilante del pool de Postgres.
 *
 * **Existe porque hay un atasco que ningún plazo del servidor puede deshacer.** Cuando el cliente
 * deja la conversación del protocolo extendido a medias —manda el `Parse`, nunca el `Sync`—,
 * Postgres se queda esperando al cliente y el cliente esperando a Postgres. En `pg_stat_activity`
 * eso se ve como una transacción abierta desde hace minutos con `wait_event_type = 'Client'`. Ahí
 * `statement_timeout` no salta, porque el enunciado ya terminó de ejecutarse, y tampoco
 * `idle_in_transaction_session_timeout`, porque el estado no es «idle in transaction».
 *
 * La conexión atascada tampoco puede matarse a sí misma: está bloqueada. Solo se la puede terminar
 * **desde fuera**, que es lo que hace esto desde su propia conexión, aparte del pool que vigila.
 *
 * Pasó en desarrollo el 1-sep-2026: dos conexiones así dejaron a WACore sin generar un solo código
 * QR durante media hora, porque crear una sesión espera a la base antes de arrancar Baileys.
 */
export interface PoolWatchdog {
  start(): void;
  stop(): Promise<void>;
  /** Una pasada, ahora. La usan los tests y sirve como sonda manual. */
  revisarAhora(): Promise<void>;
  /** Lo que lleva visto, para `/health`. */
  stats(): { terminados: number; ultimaRevision: string | null; error: string | null };
}

export interface PoolWatchdogDeps {
  databaseUrl: string;
  logger: Logger;
  /** Cada cuánto mirar. `0` o menos deja el vigilante apagado. */
  intervalMs: number;
  /** Edad de la transacción a partir de la cual se da por muerta. */
  maxAgeMs: number;
  /**
   * Cómo abrir su conexión. Solo lo pasan los tests: lo que hay que demostrar aquí es a quién
   * mata y a quién no, y eso no se puede montar contra un Postgres de verdad sin dejar una
   * conexión atascada a mano.
   */
  abrirConexion?: () => postgres.Sql;
}

interface FilaAtascada {
  pid: number;
  edad_ms: string | number;
  state: string | null;
  wait_event: string | null;
  consulta: string | null;
}

export function createPoolWatchdog(deps: PoolWatchdogDeps): PoolWatchdog {
  const { databaseUrl, logger, intervalMs, maxAgeMs, abrirConexion } = deps;

  let temporizador: ReturnType<typeof setInterval> | null = null;
  let sql: postgres.Sql | null = null;
  let terminados = 0;
  let ultimaRevision: string | null = null;
  let ultimoError: string | null = null;

  /**
   * Conexión propia, y **fuera del pool vigilado** a propósito: pedirle sitio al pool que está
   * atascado para poder desatascarlo es la manera más elegante de no arreglar nada nunca.
   */
  function conexion(): postgres.Sql {
    if (!sql) {
      sql = abrirConexion ? abrirConexion() : postgres(databaseUrl, {
        max: 1,
        idle_timeout: 30,
        connect_timeout: 10,
        // El vigilante nunca puede quedarse él mismo colgado esperando a la base.
        connection: { statement_timeout: 5_000 },
      });
    }
    return sql;
  }

  async function revisar(): Promise<void> {
    const segundos = Math.max(1, Math.round(maxAgeMs / 1000));

    try {
      const filas = await conexion()<FilaAtascada[]>`
        SELECT
          pid,
          EXTRACT(EPOCH FROM (now() - xact_start)) * 1000 AS edad_ms,
          state,
          wait_event,
          left(query, 120) AS consulta
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND xact_start IS NOT NULL
          AND EXTRACT(EPOCH FROM (now() - xact_start)) > ${segundos}
          -- Solo el atasco de protocolo: Postgres esperando a que el cliente siga hablando. Un
          -- bloqueo de fila espera en Lock y de ese ya se encarga statement_timeout; una
          -- migración larga está ejecutando, no esperando. Matar cualquiera de esos dos sería
          -- romper trabajo legítimo.
          AND wait_event_type = 'Client'
          -- Y solo lo nuestro: esta base es de WACore, pero un vigilante que termina backends
          -- ajenos porque un día compartan servidor es una avería peor que la que arregla.
          AND query ILIKE '%wacore\\_%'
      `;

      ultimaRevision = new Date().toISOString();
      ultimoError = null;

      for (const fila of filas) {
        const edad = Math.round(Number(fila.edad_ms));
        try {
          await conexion()`SELECT pg_terminate_backend(${fila.pid})`;
          terminados++;
          // A nivel `warn` y con la consulta delante: esto no es rutina. Si aparece en el registro,
          // algo dejó una conexión muerta y alguien tiene que enterarse.
          logger.warn('Conexión de Postgres atascada terminada por el vigilante', {
            pid: fila.pid,
            edadMs: edad,
            state: fila.state,
            waitEvent: fila.wait_event,
            consulta: fila.consulta,
          });
        } catch (err) {
          logger.warn('No se pudo terminar una conexión atascada de Postgres', {
            pid: fila.pid,
            error: String(err),
          });
        }
      }
    } catch (err) {
      // Que el vigilante no pueda mirar no puede tumbar el proceso ni llenar el registro: se anota
      // y se vuelve a intentar en la siguiente vuelta.
      ultimoError = String(err);
      logger.debug('El vigilante del pool no pudo revisar Postgres', { error: ultimoError });
    }
  }

  return {
    start() {
      if (temporizador) return;
      if (intervalMs <= 0) {
        logger.info('Vigilante del pool de Postgres desactivado por configuración');
        return;
      }
      temporizador = setInterval(() => { void revisar(); }, intervalMs);
      logger.info('Vigilante del pool de Postgres en marcha', { intervalMs, maxAgeMs });
    },

    revisarAhora: revisar,

    async stop() {
      if (temporizador) {
        clearInterval(temporizador);
        temporizador = null;
      }
      if (sql) {
        try { await sql.end(); } catch { /* ya cerrada */ }
        sql = null;
      }
    },

    stats() {
      return { terminados, ultimaRevision, error: ultimoError };
    },
  };
}
