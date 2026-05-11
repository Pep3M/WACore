import type { Application, Request, Response, NextFunction } from 'express';
import express from 'express';
import { existsSync } from 'fs';
import { extname, join } from 'path';
import type { Logger } from '../utils/logger';
import type { EnvConfig, SendMessageRequest, SendMediaRequest, SendPresenceRequest, ReadReceiptRequest, ApiResponse, PollMessagesResponse, MediaStore } from '../types';
import type { IncomingMessageHub } from '../core/incoming-message-hub';
import type { SSETransport } from './sse-transport';

export interface RestApi {
  start(): void;
  stop(): void;
}

export function createRestApi(
  port: number,
  config: EnvConfig,
  logger: Logger,
  sendMessage: (to: string, text: string) => Promise<string>,
  sendMedia: (req: SendMediaRequest) => Promise<string>,
  getConnectionStatus: () => string,
  getQr: () => string | null,
  logout: () => Promise<void>,
  getContacts: () => Array<{ phone: string; name: string }>,
  connect: () => Promise<void>,
  sendPresence?: (to: string, type: string, duration?: number) => Promise<void>,
  incomingHub?: IncomingMessageHub,
  sseTransport?: SSETransport,
  mediaStore?: MediaStore,
  sendReadReceipt?: (to: string, participant: string | undefined, messageIds: string[]) => Promise<void>,
): RestApi {
  if (!config.apiKey) {
    return {
      start() { logger.info('REST API disabled (no API_KEY configured)'); },
      stop() {},
    };
  }

  const app: Application = express();
  let server: ReturnType<typeof app.listen> | null = null;

  app.use(express.json());

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  function authenticate(req: Request): boolean {
    const auth = req.headers['authorization'] || req.headers['Authorization'] as string;
    if (auth === `Bearer ${config.apiKey}`) return true;
    const apiKeyParam = typeof req.query.api_key === 'string' ? req.query.api_key : '';
    return apiKeyParam === config.apiKey;
  }

  app.use((req, res, next) => {
    if (!authenticate(req)) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }
    next();
  });

  app.post('/api/send', async (req: Request, res: Response) => {
    const body = req.body as SendMessageRequest;
    if (!body.to || !body.text) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, text' });
      return;
    }
    try {
      const id = await sendMessage(body.to, body.text);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/send-media', async (req: Request, res: Response) => {
    const body = req.body as SendMediaRequest;
    if (!body.to || !body.url || !body.type) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, url, type' });
      return;
    }
    try {
      const id = await sendMedia(body);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.get('/api/status', (_req: Request, res: Response) => {
    res.json({ success: true, data: { status: getConnectionStatus(), instance: config.instanceName } });
  });

  app.get('/api/qr', (_req: Request, res: Response) => {
    const qr = getQr();
    if (!qr) {
      res.status(404).json({ success: false, error: 'No QR available (already connected?)' });
      return;
    }
    res.json({ success: true, data: { qr } });
  });

  app.delete('/api/session', async (_req: Request, res: Response) => {
    try {
      await logout();
      res.json({ success: true, data: { loggedOut: true } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.get('/api/messages', (req: Request, res: Response) => {
    if (!config.pollingEnabled || !incomingHub) {
      res.status(404).json({ success: false, error: 'Polling not enabled' });
      return;
    }
    const since = typeof req.query.since === 'string' ? req.query.since : undefined;
    let limit = 50;
    const limitParam = req.query.limit;
    if (typeof limitParam === 'string') {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 200);
    }
    const result: PollMessagesResponse = incomingHub.getRecentMessages(since, limit);
    res.json({ success: true, data: result });
  });

  app.get('/api/contacts', (_req: Request, res: Response) => {
    try {
      const contacts = getContacts();
      res.json({ success: true, data: { contacts } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/connect', async (_req: Request, res: Response) => {
    try {
      await connect();
      res.json({ success: true, data: { connecting: true } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/read', async (req: Request, res: Response) => {
    if (!sendReadReceipt) {
      res.status(404).json({ success: false, error: 'Read receipts not available' });
      return;
    }
    const { to, messageId, messageIds, participant } = req.body as ReadReceiptRequest;
    if (!to) {
      res.status(400).json({ success: false, error: 'Missing required field: to' });
      return;
    }
    const ids = messageIds ?? (messageId ? [messageId] : null);
    if (!ids || ids.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required field: messageId or messageIds' });
      return;
    }
    try {
      await sendReadReceipt(to, participant, ids);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/presence', async (req: Request, res: Response) => {
    if (!sendPresence) {
      logger.warn('POST /api/presence — sendPresence not available');
      res.status(404).json({ success: false, error: 'Presence not available' });
      return;
    }
    const { to, type, duration } = req.body as SendPresenceRequest;
    logger.info('POST /api/presence called', { to, type, duration });
    if (!to || !type) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, type' });
      return;
    }
    const validTypes = ['composing', 'recording', 'paused', 'available', 'unavailable'];
    if (!validTypes.includes(type)) {
      res.status(400).json({ success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` });
      return;
    }
    const finalDuration = (duration && typeof duration === 'number' && duration > 0) ? duration : undefined;
    try {
      await sendPresence(to, type, finalDuration);
      logger.info('POST /api/presence success', { to, type, duration: finalDuration });
      res.json({ success: true });
    } catch (err) {
      logger.error('POST /api/presence error', { to, type, error: String(err) });
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  if (mediaStore) {
    app.get('/api/media/:id', (req: Request, res: Response) => {
      const id = req.params.id;
      if (!id || Array.isArray(id)) {
        res.status(400).json({ success: false, error: 'Invalid media ID' });
        return;
      }
      const filePath = mediaStore!.getPath(id);
      if (!filePath || !existsSync(filePath)) {
        res.status(404).json({ success: false, error: 'Media not found' });
        return;
      }
      res.sendFile(filePath);
    });

    app.get('/api/media', (_req: Request, res: Response) => {
      const allIds = mediaStore!.getAllIds();
      const files = allIds.map(id => {
        const p = mediaStore!.getPath(id);
        return {
          mediaId: id,
          url: `/api/media/${id}`,
          exists: p ? existsSync(p) : false,
        };
      });
      res.json({ success: true, data: { files } });
    });
  }

  app.get('/api/messages/stream', (req: Request, res: Response) => {
    if (!sseTransport) {
      res.status(404).json({ success: false, error: 'SSE not enabled' });
      return;
    }
    sseTransport.handleConnection(req, res);
  });

  return {
    start() {
      server = app.listen(port, () => {
        logger.info('REST API started', { port });
      });
    },
    stop() {
      if (server) {
        server.close();
        server = null;
      }
    },
  };
}
