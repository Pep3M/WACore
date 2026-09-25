import type { Response, NextFunction } from 'express';
import type { AuthedRequest } from './types';

// Routes accessible without any authentication
const PUBLIC_PATHS = new Set(['/health']);

/** `Authorization: Bearer <API_KEY>` o `?api_key=<API_KEY>`. */
export function createAuthMiddleware(apiKey: string | undefined) {
  return function authMiddleware(
    req: AuthedRequest,
    res: Response,
    next: NextFunction,
  ): void {
    if (PUBLIC_PATHS.has(req.path)) {
      next();
      return;
    }

    if (apiKey) {
      const authHeader = req.headers['authorization'] as string | undefined;
      const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      const apiKeyParam = typeof req.query.api_key === 'string' ? req.query.api_key : '';
      if (bearer === apiKey || apiKeyParam === apiKey) {
        req.auth = { kind: 'apiKey' };
        next();
        return;
      }
    }

    res.status(401).json({ success: false, error: 'Unauthorized' });
  };
}
