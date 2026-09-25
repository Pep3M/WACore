export type SessionStatus = 'starting' | 'connected' | 'awaiting-qr' | 'disconnected' | 'logged-out';

export interface SessionRow {
  instanceName: string;
  accountId: string | null;
  userId: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  status: SessionStatus;
  lastSeenAt: Date | null;
}

export interface CreateSessionOpts {
  accountId: string;
  userId: string;
  displayName?: string;
}

export interface ListSessionOpts {
  accountId?: string;
}

export interface SessionInfo {
  sessionId: string;
  accountId: string | null;
  userId: string | null;
  status: SessionStatus;
  phoneNumber: string | null;
  displayName: string | null;
  lastSeenAt: Date | null;
  /** Veces que la sesión ha vuelto a conectar después de la primera conexión. */
  reconnections?: number;
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

/**
 * El registro de sesiones (Postgres) no contestó a tiempo.
 *
 * Tiene error propio porque **no es un fallo cualquiera**: es el que hay que convertir en un 503
 * rápido en lugar de dejar la petición colgada. Colgada era justo el problema — quien creaba una
 * conexión veía el modal del QR girar hasta que el consumidor cortaba a los veinte segundos, sin código y
 * sin una sola pista de qué había pasado.
 */
export class SessionRegistryUnavailableError extends Error {
  constructor(public readonly operacion: string, public readonly timeoutMs: number) {
    super(`Session registry did not respond in ${timeoutMs}ms (${operacion})`);
    this.name = 'SessionRegistryUnavailableError';
  }
}
