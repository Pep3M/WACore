import { describe, expect, it } from 'bun:test';
import { createPoolWatchdog } from '../storage/postgres-watchdog';
import { createLogger } from '../utils/logger';
import type { EnvConfig } from '../types';

/**
 * El vigilante del pool de Postgres.
 *
 * Existe por un atasco que **ningún plazo del servidor deshace**: el cliente deja la conversación
 * del protocolo a medias y Postgres se queda esperándole con la transacción abierta. `statement_timeout`
 * no salta —el enunciado ya terminó— y `idle_in_transaction_session_timeout` tampoco —el estado no
 * es «idle in transaction»—. La conexión tampoco puede matarse a sí misma, porque está bloqueada.
 *
 * Lo que hay que demostrar aquí no es que sepa matar, sino **a quién no mata**: un pool sano tiene
 * siempre varias conexiones ociosas esperando al cliente, y confundirlas con la atascada sería
 * cambiar una avería de media hora por una permanente.
 */

const config = {
  instanceName: 'test-vigilante',
  logLevel: 'error',
  logFormat: 'json',
} as unknown as EnvConfig;

const logger = createLogger(config);

interface Llamada { sql: string; valores: unknown[] }

function sqlFalso(respuestas: Array<unknown[]> | (() => never)) {
  const llamadas: Llamada[] = [];
  let i = 0;

  const sql = ((strings: TemplateStringsArray, ...valores: unknown[]) => {
    llamadas.push({ sql: strings.join('?'), valores });
    if (typeof respuestas === 'function') return Promise.reject(new Error('base caída'));
    const fila = respuestas[i] ?? [];
    i++;
    return Promise.resolve(fila);
  }) as never;

  (sql as unknown as { end: () => Promise<void> }).end = async () => {};

  return { sql, llamadas };
}

function vigilante(sql: unknown, maxAgeMs = 60_000) {
  return createPoolWatchdog({
    databaseUrl: 'postgres://noimporta/db',
    logger,
    intervalMs: 0,
    maxAgeMs,
    abrirConexion: () => sql as never,
  });
}

describe('vigilante del pool de Postgres', () => {
  it('busca solo transacciones viejas paradas esperando al cliente, y sobre tablas nuestras', async () => {
    const { sql, llamadas } = sqlFalso([[]]);

    await vigilante(sql).revisarAhora();

    const consulta = llamadas[0]!.sql;
    // Una conexión ociosa sana no tiene transacción abierta: este filtro es el que la salva.
    expect(consulta).toContain('xact_start IS NOT NULL');
    // Un bloqueo de fila espera en 'Lock' y de ese ya se encarga statement_timeout; una migración
    // larga está ejecutando. Matar cualquiera de los dos sería romper trabajo legítimo.
    expect(consulta).toContain("wait_event_type = 'Client'");
    // Y nunca a sí mismo.
    expect(consulta).toContain('pid <> pg_backend_pid()');
    expect(consulta).toContain('wacore');
    // El umbral viaja como parámetro, en segundos.
    expect(llamadas[0]!.valores).toEqual([60]);
  });

  it('termina cada backend atascado y lo cuenta', async () => {
    const { sql, llamadas } = sqlFalso([
      [
        { pid: 4321, edad_ms: '185000', state: 'active', wait_event: 'ClientRead', consulta: 'INSERT INTO wacore_sessions' },
        { pid: 4322, edad_ms: '190000', state: 'active', wait_event: 'ClientRead', consulta: 'INSERT INTO wacore_sessions' },
      ],
      [],
      [],
    ]);

    const w = vigilante(sql);
    await w.revisarAhora();

    const terminaciones = llamadas.filter(l => l.sql.includes('pg_terminate_backend'));
    expect(terminaciones).toHaveLength(2);
    expect(terminaciones.map(t => t.valores[0])).toEqual([4321, 4322]);
    expect(w.stats().terminados).toBe(2);
    expect(w.stats().ultimaRevision).not.toBeNull();
  });

  it('no mata a nadie cuando la base está sana', async () => {
    const { sql, llamadas } = sqlFalso([[]]);

    const w = vigilante(sql);
    await w.revisarAhora();

    expect(llamadas.filter(l => l.sql.includes('pg_terminate_backend'))).toHaveLength(0);
    expect(w.stats().terminados).toBe(0);
  });

  /**
   * Un vigilante que revienta el proceso al no poder mirar sería peor que no tenerlo: la avería
   * que arregla dura media hora, y esta duraría hasta que alguien reiniciase.
   */
  it('si no puede mirar, lo anota y sigue vivo', async () => {
    const { sql } = sqlFalso(() => { throw new Error('nunca'); });

    const w = vigilante(sql);
    await w.revisarAhora();

    expect(w.stats().error).toContain('base caída');
    expect(w.stats().terminados).toBe(0);
  });

  it('se puede apagar por configuración', async () => {
    const { sql, llamadas } = sqlFalso([[]]);
    const w = createPoolWatchdog({
      databaseUrl: 'postgres://noimporta/db',
      logger,
      intervalMs: 0,
      maxAgeMs: 60_000,
      abrirConexion: () => sql as never,
    });

    w.start();
    await w.stop();

    expect(llamadas).toHaveLength(0);
  });

  it('el umbral configurado llega a la consulta', async () => {
    const { sql, llamadas } = sqlFalso([[]]);

    await vigilante(sql, 15_000).revisarAhora();

    expect(llamadas[0]!.valores).toEqual([15]);
  });
});
