import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import express from 'express';
import type { Application } from 'express';
import { createAuthMiddleware } from '../auth/middleware';
import type { AuthedRequest } from '../auth/types';

const API_KEY = 'test-api-key-mw';
const PORT = 19960;
const BASE = `http://localhost:${PORT}`;

let app: Application;
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use(createAuthMiddleware(API_KEY));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/protected', (req: AuthedRequest, res) => res.json({ auth: req.auth }));

  await new Promise<void>(resolve => {
    server = app.listen(PORT, () => resolve());
  });
});

afterAll(() => {
  server?.close();
});

describe('authMiddleware', () => {
  it('allows requests with valid API_KEY bearer', async () => {
    const res = await fetch(`${BASE}/protected`, { headers: { Authorization: `Bearer ${API_KEY}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ auth: { kind: 'apiKey' } });
  });

  it('allows requests with valid ?api_key=', async () => {
    const res = await fetch(`${BASE}/protected?api_key=${API_KEY}`);
    expect(res.status).toBe(200);
  });

  it('rejects requests without credentials', async () => {
    const res = await fetch(`${BASE}/protected`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('rejects a wrong API key', async () => {
    const res = await fetch(`${BASE}/protected`, { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('rejects any other bearer token (no JWT support)', async () => {
    const res = await fetch(`${BASE}/protected`, {
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.x' },
    });
    expect(res.status).toBe(401);
  });

  it('lets /health through without credentials', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
  });

  it('rejects everything when no API key is configured', async () => {
    const other = express();
    other.use(createAuthMiddleware(undefined));
    other.get('/protected', (_req, res) => res.json({ ok: true }));
    const s = other.listen(19961);
    try {
      const res = await fetch('http://localhost:19961/protected', { headers: { Authorization: 'Bearer ' } });
      expect(res.status).toBe(401);
    } finally {
      s.close();
    }
  });
});
