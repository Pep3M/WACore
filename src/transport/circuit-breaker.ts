import type { Logger } from '../utils/logger';

type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreaker {
  recordSuccess(): void;
  recordFailure(): void;
  isAllowed(): boolean;
  getState(): CircuitState;
  reset(): void;
}

export function createCircuitBreaker(
  name: string,
  failureThreshold: number,
  resetTimeout: number,
  logger: Logger,
): CircuitBreaker {
  let state: CircuitState = 'closed';
  let failures = 0;
  let halfOpenAttempted = false;
  let openSince: number | null = null;

  return {
    recordSuccess() {
      if (state === 'half-open') {
        logger.info('Circuit breaker closed (half-open → closed)', { name });
      }
      state = 'closed';
      failures = 0;
      halfOpenAttempted = false;
      openSince = null;
    },

    recordFailure() {
      failures++;
      if (state === 'half-open') {
        state = 'open';
        openSince = Date.now();
        logger.warn('Circuit breaker opened (half-open test failed)', { name, failures });
        return;
      }

      if (state === 'closed' && failures >= failureThreshold) {
        state = 'open';
        openSince = Date.now();
        logger.warn('Circuit breaker opened', { name, failures, threshold: failureThreshold });
      }
    },

    isAllowed(): boolean {
      if (state === 'closed') return true;
      if (state === 'open') {
        if (openSince && Date.now() - openSince >= resetTimeout) {
          state = 'half-open';
          halfOpenAttempted = false;
          logger.info('Circuit breaker half-open (testing)', { name });
          return true;
        }
        return false;
      }
      if (state === 'half-open' && !halfOpenAttempted) {
        halfOpenAttempted = true;
        return true;
      }
      return false;
    },

    getState: () => state,

    reset() {
      state = 'closed';
      failures = 0;
      halfOpenAttempted = false;
      openSince = null;
    },
  };
}
