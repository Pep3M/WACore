import type { Request } from 'express';

export interface ApiKeyAuth {
  kind: 'apiKey';
}

export type AuthContext = ApiKeyAuth;

export interface AuthedRequest extends Request {
  auth?: AuthContext;
}
