import type { Application, Request, Response } from 'express';
import type { SessionManager } from '../sessions/session-manager';
import type { LabelStore } from '../storage/label-store';
import type { Logger } from '../utils/logger';
import { getSession } from './session-resolver';
import { InvalidLabelColorError } from '../services/label-manager';
import { MAX_LABEL_COLOR } from '../types/label';

function bad(res: Response, error: string): void {
  res.status(400).json({ success: false, error });
}

function fail(logger: Logger, res: Response, err: unknown, contexto: string): void {
  if (err instanceof InvalidLabelColorError) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('WhatsApp socket not connected')) {
    res.status(503).json({ success: false, error: 'WhatsApp socket not connected' });
    return;
  }
  logger.error(`${contexto} failed`, { error: msg });
  res.status(500).json({ success: false, error: msg });
}

function textoNoVacio(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

export function registerLabelRoutes(
  app: Application,
  sessionManager: SessionManager,
  labelStore: LabelStore,
  logger: Logger,
): void {
  app.get('/api/labels', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    try {
      const includeDeleted = req.query.includeDeleted === 'true';
      const labels = await labelStore.listLabels(session.sessionId, { includeDeleted });
      res.json({ success: true, data: { labels } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('GET /api/labels failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });

  /**
   * Crear o editar una etiqueta.
   *
   * **La escritura local no es una caché, es la fuente.** Las cuentas Business modernas —las de
   * la interfaz «Listas»— no disparan `labels.edit` nunca, así que esperar al eco de WhatsApp
   * dejaría este `POST` devolviendo 200 y el `GET /api/labels` vacío: parecería que no se
   * guardó nada. Se escribe en cuanto WhatsApp acepta el parche, marcada `source: 'local'`, y
   * si algún día llega la confirmación la fila asciende a `wa`.
   */
  app.post('/api/labels', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const body = (req.body ?? {}) as { id?: unknown; name?: unknown; color?: unknown; deleted?: unknown };

    if (!textoNoVacio(body.name)) return bad(res, 'Missing or invalid field: name');
    const color = typeof body.color === 'number' ? body.color : 0;
    if (!Number.isInteger(color) || color < 0 || color > MAX_LABEL_COLOR) {
      return bad(res, `Field color must be an integer between 0 and ${MAX_LABEL_COLOR}`);
    }
    if (body.id !== undefined && !textoNoVacio(body.id)) {
      return bad(res, 'Field id must be a non-empty string when provided');
    }

    // WhatsApp exige un id también al crear, así que si no viene lo ponemos nosotros. El
    // formato no importa mientras sea único dentro de la cuenta.
    const id = textoNoVacio(body.id) ? body.id.trim() : `wacore-${session.sessionId}-${Date.now()}`;
    const etiqueta = { id, name: body.name.trim(), color, deleted: body.deleted === true };

    try {
      await session.labelManager.upsert(etiqueta);
      await labelStore.upsertLabel(session.sessionId, { ...etiqueta, source: 'local' });
      const guardada = await labelStore.getLabel(session.sessionId, id);
      res.json({ success: true, data: { label: guardada } });
    } catch (err) {
      fail(logger, res, err, 'POST /api/labels');
    }
  });

  /** Borrar es marcar `deleted`: WhatsApp no tiene una baja de verdad. */
  app.delete('/api/labels/:id', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const labelId = typeof req.params.id === 'string' ? req.params.id : '';
    if (!labelId) return bad(res, 'Missing label id');

    try {
      const actual = await labelStore.getLabel(session.sessionId, labelId);
      if (!actual) {
        res.status(404).json({ success: false, error: 'Label not found' });
        return;
      }
      const etiqueta = { id: labelId, name: actual.name, color: actual.color, deleted: true };
      await session.labelManager.upsert(etiqueta);
      await labelStore.upsertLabel(session.sessionId, { ...etiqueta, source: 'local' });
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'DELETE /api/labels/:id');
    }
  });

  /** Colgar la etiqueta de una conversación o de un mensaje concreto. */
  app.post('/api/labels/:id/associations', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const labelId = typeof req.params.id === 'string' ? req.params.id : '';
    if (!labelId) return bad(res, 'Missing label id');
    const body = (req.body ?? {}) as { chatJid?: unknown; messageId?: unknown };
    if (!textoNoVacio(body.chatJid)) return bad(res, 'Missing or invalid field: chatJid');
    if (body.messageId !== undefined && !textoNoVacio(body.messageId)) {
      return bad(res, 'Field messageId must be a non-empty string when provided');
    }

    const chatJid = body.chatJid.trim();
    const messageId = textoNoVacio(body.messageId) ? body.messageId.trim() : null;

    try {
      if (messageId) {
        await session.labelManager.attachMessage(chatJid, messageId, labelId);
      } else {
        await session.labelManager.attachChat(chatJid, labelId);
      }
      await labelStore.addAssociation(session.sessionId, {
        labelId,
        type: messageId ? 'message' : 'chat',
        chatJid,
        messageId,
      });
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'POST /api/labels/:id/associations');
    }
  });

  app.delete('/api/labels/:id/associations', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const labelId = typeof req.params.id === 'string' ? req.params.id : '';
    if (!labelId) return bad(res, 'Missing label id');
    const body = (req.body ?? {}) as { chatJid?: unknown; messageId?: unknown };
    if (!textoNoVacio(body.chatJid)) return bad(res, 'Missing or invalid field: chatJid');

    const chatJid = body.chatJid.trim();
    const messageId = textoNoVacio(body.messageId) ? body.messageId.trim() : null;

    try {
      if (messageId) {
        await session.labelManager.detachMessage(chatJid, messageId, labelId);
      } else {
        await session.labelManager.detachChat(chatJid, labelId);
      }
      await labelStore.removeAssociation(session.sessionId, {
        labelId,
        type: messageId ? 'message' : 'chat',
        chatJid,
        messageId,
      });
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'DELETE /api/labels/:id/associations');
    }
  });

  app.get('/api/labels/:id/associations', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const labelId = typeof req.params.id === 'string' ? req.params.id : '';
    if (!labelId) {
      res.status(400).json({ success: false, error: 'Missing label id' });
      return;
    }
    try {
      const label = await labelStore.getLabel(session.sessionId, labelId);
      if (!label) {
        res.status(404).json({ success: false, error: 'Label not found' });
        return;
      }
      const associations = await labelStore.getAssociations(session.sessionId, labelId);
      res.json({ success: true, data: associations });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('GET /api/labels/:id/associations failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });
}
