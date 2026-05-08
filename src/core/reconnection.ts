import type { Logger } from '../utils/logger';
import type { EventBus } from './event-bus';
import type { DisconnectReason, BackoffConfig } from '../types';
import { calculateDelay } from '../utils/retry';

const BACKOFF_STRATEGIES: Record<string, BackoffConfig | undefined> = {
  connectionReplaced: { initialDelay: 1000, maxDelay: 5000, factor: 2, maxAttempts: 10 },
  timedOut:          { initialDelay: 1000, maxDelay: 30000, factor: 2, maxAttempts: 15 },
  unavailableService:{ initialDelay: 5000, maxDelay: 120000, factor: 2, maxAttempts: 20 },
  loggedOut:         { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0 },
  badSession:        { initialDelay: 1000, maxDelay: 10000, factor: 2, maxAttempts: 2 },
  restartRequired:   { initialDelay: 500, maxDelay: 5000, factor: 1.5, maxAttempts: 20 },
  multidevice:       { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0 },
  forbidden:         { initialDelay: 0, maxDelay: 0, factor: 1, maxAttempts: 0 },
};

export interface ReconnectionManager {
  getAttempt(): number;
  shouldReconnect(reason: DisconnectReason): boolean;
  getDelay(reason: DisconnectReason): number;
  reset(): void;
  recordFailure(reason: DisconnectReason): void;
}

export function createReconnectionManager(
  eventBus: EventBus,
  logger: Logger,
): ReconnectionManager {
  let attempt = 0;

  return {
    getAttempt: () => attempt,

    shouldReconnect(reason: DisconnectReason): boolean {
      const strategy = BACKOFF_STRATEGIES[reason];
      if (!strategy) return true;
      if (strategy.maxAttempts === 0) return false;
      return attempt < strategy.maxAttempts;
    },

    getDelay(reason: DisconnectReason): number {
      const strategy = BACKOFF_STRATEGIES[reason];
      if (!strategy) return calculateDelay(attempt + 1, BACKOFF_STRATEGIES.timedOut!);
      return calculateDelay(attempt + 1, strategy);
    },

    reset() {
      attempt = 0;
    },

    recordFailure(reason: DisconnectReason) {
      attempt++;
      logger.warn('Reconnection failure recorded', {
        reason,
        attempt,
        willReconnect: this.shouldReconnect(reason),
      });
    },
  };
}
