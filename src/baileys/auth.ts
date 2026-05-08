import type { Logger } from '../utils/logger';
import type { SessionStore } from '../storage/session-store';

export interface AuthState {
  creds: unknown;
  keys: unknown;
}

export interface AuthProvider {
  state: AuthState;
  saveCreds: () => Promise<void>;
}

export async function createAuthProvider(
  sessionStore: SessionStore,
  logger: Logger,
): Promise<AuthProvider> {
  const existing = await sessionStore.load();

  const state: AuthState = existing ?? {
    creds: {},
    keys: {},
  };

  if (existing) {
    logger.info('Auth state loaded from store');
  } else {
    logger.info('No existing auth state, will generate new credentials');
  }

  let saveScheduled = false;

  return {
    state,

    async saveCreds() {
      // Debounce saves to avoid excessive I/O in rapid-fire updates
      if (saveScheduled) return;
      saveScheduled = true;

      await Promise.resolve();
      saveScheduled = false;

      try {
        await sessionStore.save(state.creds, state.keys);
      } catch (err) {
        logger.error('Failed to save auth state', { error: String(err) });
      }
    },
  };
}
