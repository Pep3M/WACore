import type { Request, Response } from 'express';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import { SessionNotFoundError } from '../sessions/types';
import type { ApiResponse } from '../types';

const SESSION_ID_SAFE = /^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_-]+)?$/;

/** Sesión pedida con `X-Session-Id`. Sin cabecera, la sesión `WA_INSTANCE_NAME`. */
export function resolveSessionId(req: Request): string | undefined {
  const explicit = req.headers['x-session-id'] as string | undefined;
  if (explicit) {
    return SESSION_ID_SAFE.test(explicit) ? explicit : undefined;
  }
  return undefined;
}

export function getSession(
  req: Request,
  res: Response,
  sessionManager: SessionManager,
): ManagedSession | null {
  try {
    return sessionManager.getOrLegacy(resolveSessionId(req));
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      res.status(404).json({ success: false, error: err.message } as ApiResponse);
    } else {
      res.status(500).json({ success: false, error: String(err) } as ApiResponse);
    }
    return null;
  }
}
