import type { Application, Request, Response } from 'express';
import type { SessionManager } from '../sessions/session-manager';
import type { Logger } from '../utils/logger';
import type {
  UpdateProfileNameRequest,
  UpdateProfilePictureRequest,
  UpdateProfileStatusRequest,
} from '../types';
import { getSession } from './session-resolver';

const MAX_PICTURE_BYTES = 5 * 1024 * 1024;
const VALID_PICTURE_TYPES = ['preview', 'image'] as const;

function bad(res: Response, error: string): void {
  res.status(400).json({ success: false, error });
}

function fail(logger: Logger, res: Response, err: unknown, context: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('WhatsApp socket not connected')) {
    res.status(503).json({ success: false, error: 'WhatsApp socket not connected' });
    return;
  }
  logger.error(`${context} failed`, { error: msg });
  res.status(500).json({ success: false, error: msg });
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateJidParam(res: Response, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    bad(res, 'Missing or invalid JID in path');
    return null;
  }
  return raw;
}

interface DecodedPicture {
  buffer?: Buffer;
  url?: string;
}

function decodePictureBody(res: Response, body: UpdateProfilePictureRequest): DecodedPicture | null {
  const hasUrl = typeof body.imageUrl === 'string' && body.imageUrl.length > 0;
  const hasData = typeof body.imageData === 'string' && body.imageData.length > 0;
  if (hasUrl === hasData) {
    bad(res, 'Provide exactly one of: imageUrl, imageData');
    return null;
  }
  if (hasUrl) {
    return { url: body.imageUrl! };
  }
  // Strip data URI prefix if present
  const raw = body.imageData!;
  const b64 = raw.startsWith('data:') ? raw.split(',', 2)[1] ?? '' : raw;
  if (!b64) {
    bad(res, 'imageData is not valid base64');
    return null;
  }
  // Reject oversize BEFORE decoding to avoid allocating attacker-controlled memory.
  // base64 encodes 3 bytes per 4 chars, so decoded_len ≤ ceil(b64.length * 3 / 4).
  const decodedUpperBound = Math.ceil((b64.length * 3) / 4);
  if (decodedUpperBound > MAX_PICTURE_BYTES) {
    res.status(413).json({ success: false, error: `Image exceeds max size of ${MAX_PICTURE_BYTES} bytes` });
    return null;
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    bad(res, 'imageData is not valid base64');
    return null;
  }
  if (buffer.length === 0) {
    bad(res, 'imageData is not valid base64');
    return null;
  }
  return { buffer };
}

export function registerProfileRoutes(app: Application, sessionManager: SessionManager, logger: Logger): void {
  // Self endpoints (registered before /:jid to avoid path capture)

  app.get('/api/profile/me', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    try {
      const snapshot = await session.profileManager.getMe();
      res.json({ success: true, data: snapshot });
    } catch (err) {
      fail(logger, res, err, 'profileGetMe');
    }
  });

  app.patch('/api/profile/me/name', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const body = (req.body ?? {}) as UpdateProfileNameRequest;
    if (!isNonEmptyString(body.name)) return bad(res, 'Missing or invalid field: name');
    try {
      await session.profileManager.updateName(body.name.trim());
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'profileUpdateName');
    }
  });

  // Status must accept empty string to clear
  app.patch('/api/profile/me/status', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const body = req.body as UpdateProfileStatusRequest | undefined;
    if (!body || !('status' in body) || typeof body.status !== 'string') {
      return bad(res, 'Missing or invalid field: status (must be a string; empty string clears)');
    }
    try {
      await session.profileManager.updateStatus(body.status);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'profileUpdateStatus');
    }
  });

  app.put('/api/profile/me/picture', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const body = (req.body ?? {}) as UpdateProfilePictureRequest;
    const decoded = decodePictureBody(res, body);
    if (!decoded) return;
    try {
      const image = decoded.buffer ? decoded.buffer : { url: decoded.url! };
      await session.profileManager.updatePicture(image);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'profileUpdatePicture');
    }
  });

  app.delete('/api/profile/me/picture', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    try {
      await session.profileManager.removePicture();
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'profileRemovePicture');
    }
  });

  // Contact endpoints

  app.get('/api/profile/:jid/picture', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    const rawType = typeof req.query.type === 'string' ? req.query.type : 'image';
    if (!VALID_PICTURE_TYPES.includes(rawType as typeof VALID_PICTURE_TYPES[number])) {
      return bad(res, `Invalid type. Must be one of: ${VALID_PICTURE_TYPES.join(', ')}`);
    }
    try {
      const url = await session.profileManager.getPictureUrl(jid, rawType as 'preview' | 'image');
      res.json({ success: true, data: { url } });
    } catch (err) {
      fail(logger, res, err, 'profileGetPicture');
    }
  });

  app.get('/api/profile/:jid', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    try {
      const snapshot = await session.profileManager.getContact(jid);
      res.json({ success: true, data: snapshot });
    } catch (err) {
      fail(logger, res, err, 'profileGetContact');
    }
  });
}
