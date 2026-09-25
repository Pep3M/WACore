import { describe, expect, it } from 'bun:test';
import { PostgresSessionRegistry } from '../storage/postgres-store';

/**
 * El dueño de una sesión en el registro.
 *
 * Esto tuvo una avería que **solo se veía al reiniciar WACore**, y desde fuera parecía otra cosa
 * completamente: «WACore no responde». Lo que pasaba es que la fila de la sesión se quedaba sin
 * `account_id`, así que al reiniciar `bootstrap()` reconstruía una sesión anónima y todas las
 * llamadas del consumidor rebotaban con un 403.
 *
 * El origen: quien crea la fila primero no siempre es `ensureRow`. `save()` la inserta cada vez
 * que Baileys guarda credenciales, y lo hace sin dueño; con `ON CONFLICT DO NOTHING`, `ensureRow`
 * ya no lo rellenaba jamás.
 *
 * Se comprueba sobre el SQL generado porque es donde vive la regla —no hay lógica alrededor que
 * se pueda ejercitar sin un Postgres de verdad—, y lo que se vigila es exactamente lo que se
 * rompió: que no vuelva a ser un `DO NOTHING`, y que rellene sin pisar.
 */
function capturarSql() {
  const consultas: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    consultas.push(strings.join('?'));
    void values;
    return Promise.resolve([]);
  }) as any;
  return { sql, consultas };
}

describe('ensureRow — el dueño de la sesión', () => {
  it('rellena el dueño cuando la fila ya existe sin él', async () => {
    const { sql, consultas } = capturarSql();
    const registry = new PostgresSessionRegistry(sql);

    await registry.ensureRow('cuenta:17', 'cuenta', '17');

    const q = consultas[0]!;
    // La regresión concreta: con DO NOTHING el dueño no se escribía nunca.
    expect(q).not.toContain('DO NOTHING');
    expect(q).toContain('DO UPDATE');
  });

  /**
   * `COALESCE` y no una asignación directa. Sobrescribir un dueño ya puesto sería mover la línea
   * de una cuenta a otra desde una llamada cualquiera: mucho peor que el fallo que se arregla.
   */
  it('no pisa un dueño que ya esté puesto', async () => {
    const { sql, consultas } = capturarSql();
    const registry = new PostgresSessionRegistry(sql);

    await registry.ensureRow('cuenta:17', 'cuenta', '17');

    const q = consultas[0]!;
    expect(q).toContain('COALESCE(wacore_sessions.account_id');
    expect(q).toContain('COALESCE(wacore_sessions.user_id');
  });
});
