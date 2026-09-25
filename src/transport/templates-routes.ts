import type { Application, Request, Response } from 'express';
import type { SessionManager } from '../sessions/session-manager';
import type { TemplateStore } from '../storage/template-store';
import { DuplicateTemplateNameError } from '../storage/template-store';
import type { Logger } from '../utils/logger';
import type {
  TemplateMedia,
  TemplateMediaType,
  CreateTemplateInput,
  UpdateTemplateInput,
  SendTemplateRequest,
} from '../types/template';
import type { SendMediaRequest } from '../types';
import type { QuotedRef } from '../services/message-sender';
import { renderTemplate } from '../services/template-renderer';
import { getSession } from './session-resolver';

const MEDIA_TYPES: TemplateMediaType[] = ['image', 'video', 'document', 'audio'];

function validateMedia(raw: unknown): { ok: true; media: TemplateMedia | null } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, media: null };
  if (raw === null) return { ok: true, media: null };
  if (typeof raw !== 'object') return { ok: false, error: 'media must be an object' };
  const m = raw as Partial<TemplateMedia>;
  if (!m.type || !MEDIA_TYPES.includes(m.type)) {
    return { ok: false, error: `media.type must be one of: ${MEDIA_TYPES.join(', ')}` };
  }
  if (typeof m.url !== 'string' || m.url.length === 0) {
    return { ok: false, error: 'media.url must be a non-empty string' };
  }
  if (m.mimetype !== undefined && typeof m.mimetype !== 'string') {
    return { ok: false, error: 'media.mimetype must be a string' };
  }
  if (m.filename !== undefined && typeof m.filename !== 'string') {
    return { ok: false, error: 'media.filename must be a string' };
  }
  const media: TemplateMedia = { type: m.type, url: m.url };
  if (m.mimetype) media.mimetype = m.mimetype;
  if (m.filename) media.filename = m.filename;
  return { ok: true, media };
}

export function registerTemplateRoutes(
  app: Application,
  sessionManager: SessionManager,
  templateStore: TemplateStore,
  logger: Logger,
): void {
  app.post('/api/templates', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const body = req.body as Partial<CreateTemplateInput>;
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Missing/invalid required field: name' });
      return;
    }
    if (typeof body.body !== 'string' || body.body.length === 0) {
      res.status(400).json({ success: false, error: 'Missing/invalid required field: body' });
      return;
    }
    const mediaCheck = validateMedia(body.media);
    if (!mediaCheck.ok) {
      res.status(400).json({ success: false, error: mediaCheck.error });
      return;
    }
    try {
      const template = await templateStore.create(session.sessionId, {
        name: body.name.trim(),
        body: body.body,
        media: mediaCheck.media,
      });
      res.status(201).json({ success: true, data: template });
    } catch (err) {
      if (err instanceof DuplicateTemplateNameError) {
        res.status(409).json({ success: false, error: 'Template name already exists' });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('POST /api/templates failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.get('/api/templates', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    try {
      const templates = await templateStore.list(session.sessionId);
      res.json({ success: true, data: { templates } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('GET /api/templates failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.get('/api/templates/:id', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!id) {
      res.status(400).json({ success: false, error: 'Missing template id' });
      return;
    }
    try {
      const template = await templateStore.get(session.sessionId, id);
      if (!template) {
        res.status(404).json({ success: false, error: 'Template not found' });
        return;
      }
      res.json({ success: true, data: template });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('GET /api/templates/:id failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.put('/api/templates/:id', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!id) {
      res.status(400).json({ success: false, error: 'Missing template id' });
      return;
    }
    const body = req.body as Partial<UpdateTemplateInput> & { media?: unknown };
    const patch: UpdateTemplateInput = {};
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        res.status(400).json({ success: false, error: 'name must be a non-empty string' });
        return;
      }
      patch.name = body.name.trim();
    }
    if (body.body !== undefined) {
      if (typeof body.body !== 'string' || body.body.length === 0) {
        res.status(400).json({ success: false, error: 'body must be a non-empty string' });
        return;
      }
      patch.body = body.body;
    }
    if ('media' in body) {
      if (body.media === null) {
        patch.media = null;
      } else {
        const check = validateMedia(body.media);
        if (!check.ok) {
          res.status(400).json({ success: false, error: check.error });
          return;
        }
        patch.media = check.media;
      }
    }
    try {
      const template = await templateStore.update(session.sessionId, id, patch);
      if (!template) {
        res.status(404).json({ success: false, error: 'Template not found' });
        return;
      }
      res.json({ success: true, data: template });
    } catch (err) {
      if (err instanceof DuplicateTemplateNameError) {
        res.status(409).json({ success: false, error: 'Template name already exists' });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('PUT /api/templates/:id failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.delete('/api/templates/:id', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!id) {
      res.status(400).json({ success: false, error: 'Missing template id' });
      return;
    }
    try {
      const removed = await templateStore.delete(session.sessionId, id);
      if (!removed) {
        res.status(404).json({ success: false, error: 'Template not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('DELETE /api/templates/:id failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });

  app.post('/api/templates/:id/send', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const id = typeof req.params.id === 'string' ? req.params.id : '';
    if (!id) {
      res.status(400).json({ success: false, error: 'Missing template id' });
      return;
    }
    const body = req.body as SendTemplateRequest;
    if (!body.to || typeof body.to !== 'string') {
      res.status(400).json({ success: false, error: 'Missing required field: to' });
      return;
    }
    if (body.variables !== undefined) {
      if (typeof body.variables !== 'object' || body.variables === null || Array.isArray(body.variables)) {
        res.status(400).json({ success: false, error: 'variables must be an object' });
        return;
      }
      for (const [k, v] of Object.entries(body.variables)) {
        if (typeof v !== 'string') {
          res.status(400).json({ success: false, error: `variables.${k} must be a string` });
          return;
        }
      }
    }
    if (body.quotedMessageId !== undefined && (typeof body.quotedMessageId !== 'string' || body.quotedMessageId.length === 0)) {
      res.status(400).json({ success: false, error: 'quotedMessageId must be a non-empty string' });
      return;
    }
    if (body.quotedFromMe !== undefined && typeof body.quotedFromMe !== 'boolean') {
      res.status(400).json({ success: false, error: 'quotedFromMe must be a boolean' });
      return;
    }

    try {
      const template = await templateStore.get(session.sessionId, id);
      if (!template) {
        res.status(404).json({ success: false, error: 'Template not found' });
        return;
      }
      const vars = body.variables ?? {};
      const { text, missing } = renderTemplate(template.body, vars);
      if (missing.length > 0) {
        res.status(400).json({ success: false, error: 'Missing variables', missing });
        return;
      }

      const quoted: QuotedRef | undefined = body.quotedMessageId
        ? { id: body.quotedMessageId, participant: body.quotedParticipant, fromMe: body.quotedFromMe }
        : undefined;

      let messageId: string;
      if (template.media) {
        if (quoted) {
          res.status(400).json({ success: false, error: 'quotedMessageId is not supported for templates with media (v1)' });
          return;
        }
        const mediaReq: SendMediaRequest = {
          to: body.to,
          type: template.media.type,
          url: template.media.url,
          caption: text,
        };
        if (template.media.mimetype) mediaReq.mimetype = template.media.mimetype;
        if (template.media.filename) mediaReq.filename = template.media.filename;
        messageId = await session.messageSender.sendMedia(mediaReq);
      } else {
        messageId = await session.messageSender.sendText(body.to, text, quoted);
      }
      res.json({ success: true, data: { id: messageId, rendered: text } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('POST /api/templates/:id/send failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });
}
