import type { Logger } from '../utils/logger';
import type { EventBus } from './event-bus';
import type { DisconnectReason, BackoffConfig } from '../types';
import { calculateDelay } from '../utils/retry';

/**
 * Una estrategia de reconexión, con lo que la separa de un simple backoff: qué hacer cuando se
 * agotan los intentos.
 */
interface ReconnectStrategy extends BackoffConfig {
  /**
   * ¿Rendirse del todo al agotar `maxAttempts`?
   *
   * Solo es `true` cuando reintentar **no puede** funcionar porque hace falta una persona con el
   * móvil delante. Para todo lo demás —la red, WhatsApp, el DNS— rendirse es un error: la causa
   * desaparece sola y nadie vuelve a intentarlo.
   */
  giveUp: boolean;
}

/**
 * Cadencia a la que se sigue insistiendo una vez agotados los intentos rápidos.
 *
 * No es un capricho: sin ella, `timedOut` seguiría reintentando cada 30 s para siempre y llenaría
 * el log de una línea caída durante horas. Un minuto recupera igual de rápido de cara al usuario
 * y divide por dos el ruido.
 */
const SUSTAINED_DELAY_MS = 60_000;

const BACKOFF_STRATEGIES: Record<string, ReconnectStrategy | undefined> = {
  // Caídas de red y de servicio: **nunca** son definitivas. Las credenciales siguen siendo
  // válidas y lo único que pasa es que ahora mismo no hay camino hasta WhatsApp.
  connectionReplaced: { initialDelay: 1000, maxDelay: 5000, factor: 2, maxAttempts: 10, giveUp: false },
  timedOut:          { initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: 15, giveUp: false },
  unavailableService:{ initialDelay: 5000, maxDelay: 120000, factor: 2, maxAttempts: 20, giveUp: false },
  restartRequired:   { initialDelay: 500, maxDelay: 5000, factor: 1.5, maxAttempts: 20, giveUp: false },
  unknown:           { initialDelay: 2000, maxDelay: 30000, factor: 2, maxAttempts: 10, giveUp: false },

  // Aquí sí hace falta escanear un QR: insistir no arregla nada.
  loggedOut:         { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0, giveUp: true },
  multidevice:       { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0, giveUp: true },
  forbidden:         { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0, giveUp: true },
  // La sesión guardada está corrupta. Se le dan dos oportunidades por si fue un tropiezo al
  // leerla, y después se pide emparejar de nuevo.
  badSession:        { initialDelay: 1000, maxDelay: 10000, factor: 2, maxAttempts: 2, giveUp: true },
};

export interface ReconnectionManager {
  getAttempt(): number;
  shouldReconnect(reason: DisconnectReason): boolean;
  getDelay(reason: DisconnectReason): number;
  /**
   * ¿Se han agotado los intentos rápidos y seguimos insistiendo?
   *
   * Lo consulta el cliente para dejar la sesión marcada como caída —y que el consumidor avise a su
   * dueño— **sin** dejar de reintentar por detrás.
   */
  isExhausted(reason: DisconnectReason): boolean;
  reset(): void;
  recordFailure(reason: DisconnectReason): void;
}

export function createReconnectionManager(
  eventBus: EventBus,
  logger: Logger,
): ReconnectionManager {
  let attempt = 0;

  function strategyFor(reason: DisconnectReason): ReconnectStrategy {
    return BACKOFF_STRATEGIES[reason] ?? BACKOFF_STRATEGIES.timedOut!;
  }

  return {
    getAttempt: () => attempt,

    shouldReconnect(reason: DisconnectReason): boolean {
      const strategy = BACKOFF_STRATEGIES[reason];
      // Un motivo que no conocemos se trata como transitorio: es mucho peor abandonar una sesión
      // buena por un código nuevo de Baileys que reintentar de más.
      if (!strategy) return true;
      if (!strategy.giveUp) return true;
      if (strategy.maxAttempts === 0) return false;
      return attempt < strategy.maxAttempts;
    },

    isExhausted(reason: DisconnectReason): boolean {
      const strategy = strategyFor(reason);
      return attempt >= strategy.maxAttempts;
    },

    getDelay(reason: DisconnectReason): number {
      const strategy = strategyFor(reason);
      // Agotados los intentos rápidos se pasa a insistir con calma, en lugar de rendirse.
      if (!strategy.giveUp && attempt >= strategy.maxAttempts) {
        return calculateDelay(1, {
          initialDelay: SUSTAINED_DELAY_MS,
          maxDelay: SUSTAINED_DELAY_MS,
          factor: 1,
          maxAttempts: 1,
        });
      }
      return calculateDelay(attempt + 1, strategy);
    },

    reset() {
      attempt = 0;
    },

    recordFailure(reason: DisconnectReason) {
      attempt++;
      const strategy = strategyFor(reason);
      const exhausted = !strategy.giveUp && attempt >= strategy.maxAttempts;

      // Al entrar en insistencia sostenida se avisa una sola vez, no en cada vuelta.
      if (exhausted && attempt === strategy.maxAttempts) {
        logger.warn('Reconnection attempts exhausted; switching to sustained retry', {
          reason,
          attempt,
          everyMs: SUSTAINED_DELAY_MS,
        });
      }

      // Ya en modo sostenido, el log baja a debug: una línea caída una noche entera no debe
      // enterrar el resto del registro.
      const log = exhausted ? logger.debug.bind(logger) : logger.warn.bind(logger);
      log('Reconnection failure recorded', {
        reason,
        attempt,
        willReconnect: this.shouldReconnect(reason),
      });
    },
  };
}
