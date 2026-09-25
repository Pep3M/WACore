import type { Application, Request, Response } from 'express';
import type { SessionManager } from '../sessions/session-manager';
import type { Logger } from '../utils/logger';
import type { TrackedMessage } from '../services/last-message-tracker';
import { MissingLastMessageError } from '../services/chat-manager';
import { getSession } from './session-resolver';

function bad(res: Response, error: string): void {
  res.status(400).json({ success: false, error });
}

function fail(logger: Logger, res: Response, err: unknown, contexto: string): void {
  if (err instanceof MissingLastMessageError) {
    // 409 y no 500: no ha fallado nada, es que falta un dato que el llamante puede aportar.
    res.status(409).json({ success: false, error: err.message, code: 'missing_last_message' });
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

function jidDeRuta(res: Response, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    bad(res, 'Missing or invalid chat jid in path');
    return null;
  }
  return raw;
}

/**
 * El último mensaje que mande el llamante, si lo manda.
 *
 * Se valida entero antes de usarlo: media clave o una hora que no es un número producen un
 * parche que WhatsApp acepta y **no ejecuta**, así que un dato a medias es peor que ninguno.
 */
function ultimoDelCuerpo(res: Response, raw: unknown): TrackedMessage | null | false {
  if (raw === undefined || raw === null) return null;

  const m = raw as { id?: unknown; fromMe?: unknown; messageTimestamp?: unknown };
  if (typeof m.id !== 'string' || m.id.trim().length === 0) {
    bad(res, 'lastMessage.id is required and must be a non-empty string');
    return false;
  }
  if (typeof m.messageTimestamp !== 'number' || !Number.isFinite(m.messageTimestamp)) {
    bad(res, 'lastMessage.messageTimestamp is required and must be a number');
    return false;
  }
  return {
    key: { remoteJid: '', id: m.id.trim(), fromMe: m.fromMe === true },
    messageTimestamp: m.messageTimestamp,
  };
}

export function registerChatRoutes(app: Application, sessionManager: SessionManager, logger: Logger): void {
  /** Resuelve sesión, jid y `lastMessage` opcional; devuelve null si ya ha respondido. */
  function preparar(req: Request, res: Response) {
    const session = getSession(req, res, sessionManager);
    if (!session) return null;
    const jid = jidDeRuta(res, req.params.jid);
    if (!jid) return null;
    const cuerpo = (req.body ?? {}) as Record<string, unknown>;
    const ultimo = ultimoDelCuerpo(res, cuerpo.lastMessage);
    if (ultimo === false) return null;
    const conJid = ultimo ? { ...ultimo, key: { ...ultimo.key, remoteJid: jid } } : undefined;
    return { session, jid, cuerpo, ultimo: conJid };
  }

  app.post('/api/chats/:jid/archive', async (req: Request, res: Response) => {
    const ctx = preparar(req, res);
    if (!ctx) return;
    if (typeof ctx.cuerpo.archive !== 'boolean') return bad(res, 'Field archive is required and must be boolean');
    try {
      await ctx.session.chatManager.archive(ctx.jid, ctx.cuerpo.archive, ctx.ultimo);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'POST /api/chats/:jid/archive');
    }
  });

  app.post('/api/chats/:jid/read', async (req: Request, res: Response) => {
    const ctx = preparar(req, res);
    if (!ctx) return;
    if (typeof ctx.cuerpo.read !== 'boolean') return bad(res, 'Field read is required and must be boolean');
    try {
      await ctx.session.chatManager.markRead(ctx.jid, ctx.cuerpo.read, ctx.ultimo);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'POST /api/chats/:jid/read');
    }
  });

  app.post('/api/chats/:jid/pin', async (req: Request, res: Response) => {
    const ctx = preparar(req, res);
    if (!ctx) return;
    if (typeof ctx.cuerpo.pin !== 'boolean') return bad(res, 'Field pin is required and must be boolean');
    try {
      await ctx.session.chatManager.pin(ctx.jid, ctx.cuerpo.pin);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'POST /api/chats/:jid/pin');
    }
  });

  /**
   * Silenciar. `muteEndTimestamp` es el **instante en que deja de estar silenciado**, en
   * milisegundos desde epoch — no una duración. Mandar «3600» silenciaría hasta 1970, y
   * WhatsApp lo aceptaría sin rechistar; de ahí que se exija que esté en el futuro.
   */
  app.post('/api/chats/:jid/mute', async (req: Request, res: Response) => {
    const ctx = preparar(req, res);
    if (!ctx) return;
    const valor = ctx.cuerpo.muteEndTimestamp;
    if (valor !== null && (typeof valor !== 'number' || !Number.isFinite(valor))) {
      return bad(res, 'Field muteEndTimestamp is required: a future epoch-ms timestamp, or null to unmute');
    }
    if (typeof valor === 'number' && valor <= Date.now()) {
      return bad(res, 'muteEndTimestamp must be in the future (it is an absolute end time, not a duration)');
    }
    try {
      await ctx.session.chatManager.mute(ctx.jid, valor as number | null);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'POST /api/chats/:jid/mute');
    }
  });

  app.post('/api/chats/:jid/block', async (req: Request, res: Response) => {
    const ctx = preparar(req, res);
    if (!ctx) return;
    if (typeof ctx.cuerpo.block !== 'boolean') return bad(res, 'Field block is required and must be boolean');
    try {
      await ctx.session.chatManager.block(ctx.jid, ctx.cuerpo.block);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'POST /api/chats/:jid/block');
    }
  });

  app.delete('/api/chats/:jid', async (req: Request, res: Response) => {
    const ctx = preparar(req, res);
    if (!ctx) return;
    try {
      await ctx.session.chatManager.remove(ctx.jid, ctx.ultimo);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'DELETE /api/chats/:jid');
    }
  });
}
