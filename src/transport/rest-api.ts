import type { Application, Request, Response } from 'express';
import express from 'express';
import { existsSync } from 'fs';
import type { Logger } from '../utils/logger';
import type { EnvConfig, SendMessageRequest, SendMediaRequest, SendPresenceRequest, ReadReceiptRequest, PollMessagesResponse, MediaStore, SendStickerRequest, SendLocationRequest, SendContactRequest, SendPttRequest, ForwardMessageRequest, CheckNumbersRequest, EditMessageRequest, SendButtonsRequest, SendListRequest } from '../types';
import type { IncomingMessageHub } from '../core/incoming-message-hub';
import type { SSETransport } from './sse-transport';
import type { ContactStore } from '../storage/contact-store';
import type { LabelStore } from '../storage/label-store';
import type { TemplateStore } from '../storage/template-store';
import type { SessionManager } from '../sessions/session-manager';
import { CatalogoSinRespuesta } from '../services/catalog-manager';
import { createAuthMiddleware } from '../auth/middleware';
import { buttonsAsText, listAsText } from '../services/interactive-text';
import { registerGroupRoutes } from './groups-routes';
import { registerProfileRoutes } from './profile-routes';
import { registerChatRoutes } from './chats-routes';
import { registerLabelRoutes } from './labels-routes';
import { registerTemplateRoutes } from './templates-routes';
import { resolveSessionId as resolveSessionIdShared, getSession as getSessionShared } from './session-resolver';

export interface RestApi {
  start(): void;
  stop(): void;
}

export function createRestApi(
  port: number,
  config: EnvConfig,
  logger: Logger,
  sessionManager: SessionManager,
  incomingHub?: IncomingMessageHub,
  sseTransport?: SSETransport,
  mediaStore?: MediaStore,
  contactStore?: ContactStore,
  labelStore?: LabelStore,
  templateStore?: TemplateStore,
): RestApi {
  if (!config.apiKey) {
    return {
      start() { logger.info('REST API disabled (no API_KEY configured)'); },
      stop() {},
    };
  }

  const app: Application = express();
  let server: ReturnType<typeof app.listen> | null = null;

  // 10mb ceiling accommodates base64-inline media uploads (profile picture up to 5MB decoded)
  app.use(express.json({ limit: '10mb' }));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    // PUT y PATCH faltaban aunque ya había rutas de los dos (perfil, grupos): el preflight
    // de cualquier navegador las rechazaba antes de llegar aquí.
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(createAuthMiddleware(config.apiKey));

  // ─── Groups ───────────────────────────────────
  registerGroupRoutes(app, sessionManager, logger);

  // ─── Profile ──────────────────────────────────
  registerProfileRoutes(app, sessionManager, logger);

  // ─── Chats: archivar, fijar, silenciar, bloquear ─────────────
  registerChatRoutes(app, sessionManager, logger);

  // ─── Labels ───────────────────────────────────
  if (labelStore) {
    registerLabelRoutes(app, sessionManager, labelStore, logger);
  }

  // ─── Templates ────────────────────────────────
  if (templateStore) {
    registerTemplateRoutes(app, sessionManager, templateStore, logger);
  }

  const resolveSessionId = resolveSessionIdShared;
  const getSession = (req: Request, res: Response) => getSessionShared(req, res, sessionManager);

  // ─── Send ────────────────────────────────────────────────────
  app.post('/api/send', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = req.body as SendMessageRequest;
    if (!body.to || !body.text) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, text' });
      return;
    }
    if (body.quotedMessageId !== undefined && (typeof body.quotedMessageId !== 'string' || body.quotedMessageId.length === 0)) {
      res.status(400).json({ success: false, error: 'quotedMessageId must be a non-empty string' });
      return;
    }
    if (body.quotedFromMe !== undefined && typeof body.quotedFromMe !== 'boolean') {
      res.status(400).json({ success: false, error: 'quotedFromMe must be a boolean' });
      return;
    }
    const quoted = body.quotedMessageId
      ? { id: body.quotedMessageId, participant: body.quotedParticipant, fromMe: body.quotedFromMe }
      : undefined;
    try {
      const id = await session.messageSender.sendText(body.to, body.text, quoted);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/send-media', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = req.body as SendMediaRequest;
    if (!body.to || !body.url || !body.type) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, url, type' });
      return;
    }
    try {
      const id = await session.messageSender.sendMedia(body);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/send-sticker', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = req.body as SendStickerRequest;
    if (!body.to || !body.url) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, url' });
      return;
    }
    try {
      const id = await session.messageSender.sendSticker(body.to, body.url, body.mimetype);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/send-location', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = req.body as SendLocationRequest;
    if (!body.to || typeof body.latitude !== 'number' || typeof body.longitude !== 'number') {
      res.status(400).json({ success: false, error: 'Missing/invalid required fields: to, latitude (number), longitude (number)' });
      return;
    }
    if (body.latitude < -90 || body.latitude > 90 || body.longitude < -180 || body.longitude > 180) {
      res.status(400).json({ success: false, error: 'latitude must be in [-90,90], longitude in [-180,180]' });
      return;
    }
    try {
      const id = await session.messageSender.sendLocation(body.to, body.latitude, body.longitude, body.name, body.address);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/send-contact', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = req.body as SendContactRequest;
    if (!body.to || !body.displayName || !Array.isArray(body.contacts) || body.contacts.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, displayName, contacts (non-empty array)' });
      return;
    }
    if (!body.contacts.every((c) => typeof c?.vcard === 'string' && c.vcard.length > 0)) {
      res.status(400).json({ success: false, error: 'Each contact must have a non-empty vcard string' });
      return;
    }
    try {
      const id = await session.messageSender.sendContact(body.to, body.displayName, body.contacts);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ─── Interactivos (botones y listas) ─────────────────────────
  //
  // Detrás de bandera y apagados por omisión. Son los formatos interactivos **antiguos**:
  // muchos clientes los pintan como texto plano y, en números que no son Business, usarlos
  // es una de las señales que llevan al bloqueo de la línea. Encenderlos es una decisión
  // consciente, no un valor por defecto.

  function interactivosApagados(res: Response): boolean {
    if (config.interactiveMessages) return false;
    res.status(501).json({
      success: false,
      error: 'Interactive messages are disabled. Set WACORE_INTERACTIVE_MESSAGES=true to enable them.',
    });
    return true;
  }

  app.post('/api/send-buttons', async (req: Request, res: Response) => {
    if (interactivosApagados(res)) return;
    const session = getSession(req, res);
    if (!session) return;
    const body = (req.body ?? {}) as SendButtonsRequest;

    if (typeof body.to !== 'string' || body.to.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: to' });
      return;
    }
    if (typeof body.body !== 'string' || body.body.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: body' });
      return;
    }
    if (!Array.isArray(body.buttons) || body.buttons.length === 0 || body.buttons.length > 3) {
      // WhatsApp no acepta más de tres: por encima, el mensaje se rechaza entero.
      res.status(400).json({ success: false, error: 'Field buttons must have between 1 and 3 items' });
      return;
    }
    if (!body.buttons.every((b) => b && typeof b.id === 'string' && typeof b.title === 'string' && b.title.trim().length > 0)) {
      res.status(400).json({ success: false, error: 'Each button needs a string id and a non-empty title' });
      return;
    }

    try {
      const id = await session.messageSender.sendButtons(body.to, body.body, body.buttons, body.footer);
      res.json({ success: true, data: { id, sentAs: 'buttons' } });
    } catch (err) {
      if (body.fallbackToText === false) {
        res.status(500).json({ success: false, error: String(err) });
        return;
      }
      // Mejor que el cliente reciba las opciones numeradas y conteste «2» a que no reciba
      // nada. Se dice en la respuesta por qué camino salió: degradar en silencio dejaría al
      // llamante creyendo que hay botones donde no los hay.
      logger.warn('Buttons rejected, falling back to text', { to: body.to, error: String(err) });
      try {
        const id = await session.messageSender.sendText(body.to, buttonsAsText(body));
        res.json({ success: true, data: { id, sentAs: 'text', fallbackReason: String(err) } });
      } catch (err2) {
        res.status(500).json({ success: false, error: String(err2) });
      }
    }
  });

  app.post('/api/send-list', async (req: Request, res: Response) => {
    if (interactivosApagados(res)) return;
    const session = getSession(req, res);
    if (!session) return;
    const body = (req.body ?? {}) as SendListRequest;

    if (typeof body.to !== 'string' || body.to.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: to' });
      return;
    }
    if (typeof body.body !== 'string' || body.body.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: body' });
      return;
    }
    if (!Array.isArray(body.sections) || body.sections.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required field: sections[]' });
      return;
    }
    const filas = body.sections.reduce((n, s) => n + (Array.isArray(s?.rows) ? s.rows.length : 0), 0);
    if (filas === 0) {
      res.status(400).json({ success: false, error: 'sections[] must contain at least one row' });
      return;
    }

    try {
      const id = await session.messageSender.sendList(body.to, body.body, body.sections, body.header, body.footer);
      res.json({ success: true, data: { id, sentAs: 'list' } });
    } catch (err) {
      if (body.fallbackToText === false) {
        res.status(500).json({ success: false, error: String(err) });
        return;
      }
      logger.warn('List rejected, falling back to text', { to: body.to, error: String(err) });
      try {
        const id = await session.messageSender.sendText(body.to, listAsText(body));
        res.json({ success: true, data: { id, sentAs: 'text', fallbackReason: String(err) } });
      } catch (err2) {
        res.status(500).json({ success: false, error: String(err2) });
      }
    }
  });

  app.post('/api/send-ptt', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = req.body as SendPttRequest;
    if (!body.to || !body.url) {
      res.status(400).json({ success: false, error: 'Missing required fields: to, url' });
      return;
    }
    try {
      const id = await session.messageSender.sendPtt(body.to, body.url, body.mimetype);
      res.json({ success: true, data: { id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ─── Forward ─────────────────────────────────────────────────
  const forwardHandler = async (req: Request, res: Response): Promise<void> => {
    const session = getSession(req, res);
    if (!session) return;
    const body = req.body as Partial<ForwardMessageRequest>;
    if (typeof body?.from !== 'string' || body.from.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required field: from' });
      return;
    }
    if (typeof body?.messageId !== 'string' || body.messageId.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required field: messageId' });
      return;
    }
    if (!Array.isArray(body.to) || body.to.length === 0 || !body.to.every(t => typeof t === 'string' && t.length > 0)) {
      res.status(400).json({ success: false, error: 'Field to must be a non-empty array of strings' });
      return;
    }
    try {
      const results = await session.messageSender.forward(body.from, body.messageId, body.to);
      const allNotFound = results.every(r => !r.ok && r.error === 'not_found');
      if (allNotFound) {
        res.status(404).json({ success: false, error: 'source_message_not_found', data: { results } });
        return;
      }
      const allOk = results.every(r => r.ok);
      res.status(allOk ? 200 : 207).json({ success: allOk, data: { results } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  };
  app.post('/api/forward', forwardHandler);

  // ─── Status / QR ─────────────────────────────────────────────
  app.get('/api/status', (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const status = session.client.getConnectionStatus();
    const info = session.getInfo();
    // `connection`, `phoneNumber`, `uptimeSeconds` y `reconnections` repiten lo que da `/health`:
    // los consumidores de una sola línea (maria-vendor) leen el estado completo de aquí.
    res.json({
      success: true,
      data: {
        status,
        instance: session.sessionId,
        connection: status,
        phoneNumber: info.phoneNumber,
        uptimeSeconds: Math.floor(process.uptime()),
        reconnections: info.reconnections ?? 0,
      },
    });
  });

  app.get('/api/qr', (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const qr = session.client.getQr();
    if (!qr) {
      res.status(404).json({ success: false, error: 'No QR available (already connected?)' });
      return;
    }
    res.json({ success: true, data: { qr } });
  });

  app.delete('/api/session', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    try {
      await session.logout();
      res.json({ success: true, data: { loggedOut: true } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ─── Connect ─────────────────────────────────────────────────
  app.post('/api/connect', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    try {
      await session.client.connect();
      res.json({ success: true, data: { connecting: true } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ─── Presence / Read ─────────────────────────────────────────
  app.post('/api/presence', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
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
      await session.presenceManager.setPresence(to, type as any, finalDuration);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/presence/subscribe', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const { to } = req.body as { to?: string };
    if (!to || typeof to !== 'string') {
      res.status(400).json({ success: false, error: 'Missing required field: to' });
      return;
    }
    const trimmed = to.trim();
    const jid = trimmed.includes('@') ? trimmed : `${trimmed}@s.whatsapp.net`;
    const VALID_SUFFIXES = ['@s.whatsapp.net', '@g.us', '@lid', '@newsletter', '@broadcast'];
    const suffixOk = VALID_SUFFIXES.some(s => jid.endsWith(s));
    const localPart = jid.split('@')[0] ?? '';
    if (!suffixOk || !localPart || !/^[0-9A-Za-z._-]+$/.test(localPart)) {
      res.status(400).json({ success: false, error: `Invalid JID: ${to}` });
      return;
    }
    try {
      await Promise.race([
        session.client.presenceSubscribe(jid),
        new Promise((_, reject) => setTimeout(() => reject(new Error('presenceSubscribe timeout')), 10_000)),
      ]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/read', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
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
      await session.readReceiptManager.sendReadReceipt(to, ids, participant);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ─── Messages (polling) ──────────────────────────────────────
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
    // Filter messages by the requesting session so tenants only see their own messages.
    const sessionId = resolveSessionId(req) ?? config.instanceName;
    const result: PollMessagesResponse = incomingHub.getRecentMessages(since, limit, sessionId);
    res.json({ success: true, data: result });
  });

  app.delete('/api/messages/:chatId/:messageId', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const { chatId, messageId } = req.params;
    if (!chatId || !messageId || Array.isArray(chatId) || Array.isArray(messageId)) {
      res.status(400).json({ success: false, error: 'Missing required params: chatId, messageId' });
      return;
    }
    const raw = (req.body ?? {}) as { fromMe?: unknown; participant?: unknown };
    let fromMe: boolean | undefined;
    let participant: string | undefined;
    if (raw.fromMe !== undefined) {
      if (typeof raw.fromMe !== 'boolean') {
        res.status(400).json({ success: false, error: 'Field fromMe must be boolean' });
        return;
      }
      fromMe = raw.fromMe;
    }
    if (raw.participant !== undefined) {
      if (typeof raw.participant !== 'string') {
        res.status(400).json({ success: false, error: 'Field participant must be string' });
        return;
      }
      participant = raw.participant;
    }
    try {
      await session.messageSender.revoke(chatId, messageId, { fromMe, participant });
      res.json({ success: true, data: { revoked: true, chatId, messageId } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.patch('/api/messages/:chatId/:messageId', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const { chatId, messageId } = req.params;
    if (!chatId || !messageId || Array.isArray(chatId) || Array.isArray(messageId)) {
      res.status(400).json({ success: false, error: 'Missing required params: chatId, messageId' });
      return;
    }
    const body = (req.body ?? {}) as EditMessageRequest;
    if (typeof body.text !== 'string' || body.text.trim().length === 0) {
      res.status(400).json({ success: false, error: 'Field text is required and must be a non-empty string' });
      return;
    }
    try {
      const id = await session.messageSender.edit(chatId, messageId, body.text);
      res.json({ success: true, data: { edited: true, chatId, messageId, id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // Los tres únicos que ofrece la aplicación de WhatsApp. Aceptar otro valor es pedir que el
  // fijado dure algo que la interfaz del cliente no sabe representar.
  const PIN_SECONDS = [86_400, 604_800, 2_592_000];

  app.post('/api/messages/:chatId/:messageId/pin', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const { chatId, messageId } = req.params;
    if (!chatId || !messageId || Array.isArray(chatId) || Array.isArray(messageId)) {
      res.status(400).json({ success: false, error: 'Missing required params: chatId, messageId' });
      return;
    }
    const body = (req.body ?? {}) as { pin?: unknown; seconds?: unknown; fromMe?: unknown };
    if (typeof body.pin !== 'boolean') {
      res.status(400).json({ success: false, error: 'Field pin is required and must be boolean' });
      return;
    }
    if (body.seconds !== undefined && !PIN_SECONDS.includes(body.seconds as number)) {
      res.status(400).json({
        success: false,
        error: `Field seconds must be one of ${PIN_SECONDS.join(', ')} (24h, 7d, 30d)`,
      });
      return;
    }
    if (body.fromMe !== undefined && typeof body.fromMe !== 'boolean') {
      res.status(400).json({ success: false, error: 'Field fromMe must be boolean' });
      return;
    }
    try {
      const id = await session.messageSender.pin(
        chatId, messageId, body.pin, body.seconds as number | undefined, body.fromMe as boolean | undefined,
      );
      res.json({ success: true, data: { pinned: body.pin, chatId, messageId, id } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  app.post('/api/messages/:chatId/:messageId/reaction', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const { chatId, messageId } = req.params;
    if (!chatId || !messageId || Array.isArray(chatId) || Array.isArray(messageId)) {
      res.status(400).json({ success: false, error: 'Missing required params: chatId, messageId' });
      return;
    }
    const raw = (req.body ?? {}) as { emoji?: unknown; fromMe?: unknown; participant?: unknown };
    if (typeof raw.emoji !== 'string') {
      res.status(400).json({ success: false, error: 'Field emoji is required and must be string (use "" to remove reaction)' });
      return;
    }
    const emoji = raw.emoji;
    let fromMe: boolean | undefined;
    let participant: string | undefined;
    if (raw.fromMe !== undefined) {
      if (typeof raw.fromMe !== 'boolean') {
        res.status(400).json({ success: false, error: 'Field fromMe must be boolean' });
        return;
      }
      fromMe = raw.fromMe;
    }
    if (raw.participant !== undefined) {
      if (typeof raw.participant !== 'string') {
        res.status(400).json({ success: false, error: 'Field participant must be string' });
        return;
      }
      participant = raw.participant;
    }
    try {
      await session.messageSender.react(chatId, messageId, emoji, { fromMe, participant });
      res.json({ success: true, data: { reacted: true, chatId, messageId, emoji } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ─── Contacts ────────────────────────────────────────────────
  // Tope duro. Preguntar por miles de números seguidos es un patrón que WhatsApp
  // reconoce como abuso, y el que paga la factura es el número del cliente.
  const MAX_NUMBERS_PER_CHECK = 200;

  app.post('/api/contacts/check', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = (req.body ?? {}) as CheckNumbersRequest;

    if (!Array.isArray(body.numbers) || body.numbers.length === 0) {
      res.status(400).json({ success: false, error: 'Missing required field: numbers[]' });
      return;
    }
    if (body.numbers.length > MAX_NUMBERS_PER_CHECK) {
      res.status(400).json({
        success: false,
        error: `Too many numbers (max ${MAX_NUMBERS_PER_CHECK} per request)`,
      });
      return;
    }
    if (!body.numbers.every((n) => typeof n === 'string' && n.trim().length > 0)) {
      res.status(400).json({ success: false, error: 'numbers[] must be non-empty strings' });
      return;
    }

    try {
      const results = await session.profileManager.checkNumbers(body.numbers);
      res.json({ success: true, data: { results, total: results.length } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 503 y no 500 a propósito: quien llama tiene que poder distinguir «la línea
      // está caída» de «falló la consulta», para degradar en vez de bloquear.
      if (msg.includes('WhatsApp socket not connected')) {
        res.status(503).json({ success: false, error: 'WhatsApp socket not connected' });
        return;
      }
      logger.error('checkNumbers failed', { error: msg });
      res.status(500).json({ success: false, error: msg });
    }
  });

  // La agenda es **de la línea que pregunta**: todas estas rutas resuelven la sesión y leen solo
  // la suya. Antes listaban la tabla entera y cada línea recibía los contactos de todas.
  app.get('/api/contacts', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    try {
      if (contactStore) {
        const opts = parseListOpts(req);
        opts.limit = opts.limit ?? 100;
        const result = await contactStore.list(session.sessionId, opts);
        res.json({
          success: true,
          data: {
            contacts: result.items,
            total: result.total,
            limit: opts.limit,
            offset: opts.offset ?? 0,
          },
        });
      } else {
        const contacts = session.client.getContacts();
        res.json({ success: true, data: { contacts, total: contacts.length, limit: contacts.length, offset: 0 } });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  /**
   * Vuelve a pedir la agenda entera a WhatsApp y contesta cuando ya está guardada.
   *
   * Es el paso previo a importarla: una línea recién emparejada todavía la está recibiendo, y
   * una que ya estaba conectada antes de que la agenda fuera por línea no tiene nada guardado.
   */
  app.post('/api/contacts/resync', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;

    if (session.client.getConnectionStatus() !== 'connected') {
      res.status(409).json({ success: false, error: 'La línea no está conectada' });
      return;
    }

    try {
      const result = await session.client.resyncContacts();
      res.json({ success: true, data: result });
    } catch (err) {
      logger.warn('No se pudo resincronizar la agenda', { sessionId: session.sessionId, error: String(err) });
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // ─── Media ───────────────────────────────────────────────────
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

  // ─── Catálogo de WhatsApp Business ───────────────────────────
  //
  // Todo esto exige que la línea sea una **cuenta Business**. Con una cuenta personal WhatsApp
  // responde con un error genérico, no con «no tienes catálogo», así que el mensaje que llega al
  // consumidor no explica nada por sí solo.

  /** Cuántos productos como mucho por página. Más que esto lo rechaza WhatsApp. */
  const MAX_CATALOGO_POR_PAGINA = 100;

  /**
   * Valida y normaliza el cuerpo de un producto.
   *
   * @returns el producto listo, o un texto con el motivo del rechazo.
   */
  function leerProducto(body: any): { ok: true; value: any } | { ok: false; error: string } {
    if (typeof body?.name !== 'string' || body.name.trim() === '') {
      return { ok: false, error: 'Missing or invalid field: name' };
    }
    if (typeof body?.description !== 'string') {
      return { ok: false, error: 'Missing or invalid field: description' };
    }
    // Cero es un precio válido en muchos sitios pero no en un catálogo: WhatsApp lo rechaza y un
    // negativo no significa nada. Vale la pena decirlo aquí y no dejar que falle por dentro.
    if (typeof body?.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) {
      return { ok: false, error: 'Missing or invalid field: price (must be a positive number)' };
    }
    if (typeof body?.currency !== 'string' || body.currency.trim().length !== 3) {
      return { ok: false, error: 'Missing or invalid field: currency (3-letter code)' };
    }
    if (!Array.isArray(body?.images) || body.images.length === 0) {
      return { ok: false, error: 'Missing required field: images[] (WhatsApp requires at least one)' };
    }
    if (!body.images.every((u: unknown) => typeof u === 'string' && u.startsWith('http'))) {
      return { ok: false, error: 'images[] must be public http(s) URLs' };
    }

    return {
      ok: true,
      value: {
        name: body.name,
        description: body.description,
        price: body.price,
        currency: body.currency.toUpperCase(),
        retailerId: typeof body.retailerId === 'string' ? body.retailerId : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
        isHidden: body.isHidden === true,
        images: body.images,
        originCountryCode: typeof body.originCountryCode === 'string' ? body.originCountryCode : undefined,
      },
    };
  }

  app.get('/api/catalog', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;

    const bruto = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = !isNaN(bruto) && bruto > 0 ? Math.min(bruto, MAX_CATALOGO_POR_PAGINA) : MAX_CATALOGO_POR_PAGINA;
    const cursor = typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : undefined;
    // Sin `jid` se lee el catálogo **propio**. Con él, el de otro negocio: es lo que hace falta
    // para responder sobre un producto que un cliente ha compartido desde otra tienda, y para
    // diagnosticar cuándo el catálogo propio contesta vacío.
    const jid = typeof req.query.jid === 'string' && req.query.jid ? req.query.jid : undefined;

    try {
      const page = await session.catalogManager.list({ limit, cursor, jid });
      res.json({ success: true, data: page });
    } catch (err) {
      responderCatalogo(res, err, 'list catalog');
    }
  });

  app.get('/api/catalog/collections', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;

    try {
      const collections = await session.catalogManager.collections();
      res.json({ success: true, data: { collections } });
    } catch (err) {
      responderCatalogo(res, err, 'list collections');
    }
  });

  app.post('/api/catalog/products', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;

    const leido = leerProducto(req.body);
    if (!leido.ok) {
      res.status(400).json({ success: false, error: leido.error });
      return;
    }

    try {
      const product = await session.catalogManager.create(leido.value);
      res.json({ success: true, data: { product } });
    } catch (err) {
      responderCatalogo(res, err, 'create product');
    }
  });

  app.patch('/api/catalog/products/:productId', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;

    const leido = leerProducto(req.body);
    if (!leido.ok) {
      res.status(400).json({ success: false, error: leido.error });
      return;
    }

    try {
      const product = await session.catalogManager.update(String(req.params.productId), leido.value);
      res.json({ success: true, data: { product } });
    } catch (err) {
      responderCatalogo(res, err, 'update product');
    }
  });

  app.delete('/api/catalog/products/:productId', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;

    try {
      const deleted = await session.catalogManager.remove([String(req.params.productId)]);
      // Borrar algo que ya no está no es un fallo: el consumidor reintenta y tiene que poder darlo por
      // hecho. `deleted: 0` lo dice sin necesidad de un código de error.
      res.json({ success: true, data: { deleted } });
    } catch (err) {
      responderCatalogo(res, err, 'delete product');
    }
  });

  app.get('/api/orders/:orderId', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;

    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) {
      // El token llega dentro del propio mensaje del pedido y **caduca**. Sin él no hay forma de
      // pedir las líneas, y decirlo claro evita que alguien lo busque en la configuración.
      res.status(400).json({ success: false, error: 'Missing required query param: token (comes with the order message)' });
      return;
    }

    try {
      const order = await session.catalogManager.order(String(req.params.orderId), token);
      res.json({ success: true, data: { order } });
    } catch (err) {
      responderCatalogo(res, err, 'get order');
    }
  });

  /**
   * Respuesta común de los caminos de catálogo.
   *
   * El 503 se separa a propósito del 500, igual que en la comprobación de números: quien llama
   * tiene que poder distinguir «la línea está caída» —que se reintenta— de «WhatsApp ha dicho que
   * no» —que no—, y con un 500 para todo acabaría reintentando en balde.
   */
  function responderCatalogo(res: Response, err: unknown, accion: string): void {
    const msg = err instanceof Error ? err.message : String(err);

    if (msg.includes('WhatsApp socket not connected')) {
      res.status(503).json({ success: false, error: 'WhatsApp socket not connected' });
      return;
    }

    // WhatsApp no contestó. Va con 504 y no con 500 porque no es un fallo de este servicio:
    // quien llama tiene que dejar de insistir y mirar la cuenta, no el producto.
    if (err instanceof CatalogoSinRespuesta) {
      logger.warn(`Catalog: WhatsApp did not answer (${accion})`, { error: msg });
      res.status(504).json({ success: false, error: msg });
      return;
    }

    logger.error(`Catalog: failed to ${accion}`, { error: msg });
    res.status(500).json({ success: false, error: msg });
  }

  // ─── Citas de calendario y fichas de producto ────────────────

  app.post('/api/send-event', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = (req.body ?? {}) as any;

    if (typeof body.to !== 'string' || body.to.trim() === '') {
      res.status(400).json({ success: false, error: 'Missing or invalid field: to' });
      return;
    }
    if (typeof body.name !== 'string' || body.name.trim() === '') {
      res.status(400).json({ success: false, error: 'Missing or invalid field: name' });
      return;
    }
    if (typeof body.startTime !== 'number' || !Number.isFinite(body.startTime)) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: startTime (unix seconds)' });
      return;
    }
    if (body.endTime !== undefined && (typeof body.endTime !== 'number' || body.endTime < body.startTime)) {
      res.status(400).json({ success: false, error: 'endTime must be a unix timestamp at or after startTime' });
      return;
    }
    if (body.call !== undefined && body.call !== 'audio' && body.call !== 'video') {
      res.status(400).json({ success: false, error: "call must be 'audio' or 'video'" });
      return;
    }
    if (body.location !== undefined) {
      const { latitude, longitude } = body.location ?? {};
      // Una ubicación sin coordenadas de verdad pinta un marcador roto en el móvil del cliente.
      // Es preferible rechazarla y que quien llama la lleve a la descripción.
      if (typeof latitude !== 'number' || typeof longitude !== 'number'
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        res.status(400).json({ success: false, error: 'location requires numeric latitude/longitude in range' });
        return;
      }
    }

    try {
      const id = await session.messageSender.sendEvent(body.to, {
        name: body.name,
        description: typeof body.description === 'string' ? body.description : undefined,
        startTime: body.startTime,
        endTime: body.endTime,
        location: body.location,
        call: body.call,
        isCancelled: body.isCancelled === true,
        extraGuestsAllowed: body.extraGuestsAllowed === true,
      });
      // No hay actualización de un evento ya enviado: el contenido `event` de Baileys no admite
      // `edit`, al revés que un texto o una encuesta. Cada llamada crea una tarjeta nueva, y
      // cancelar es volver a mandarla con `isCancelled`. Va en la respuesta para que el consumidor no
      // tenga que descubrirlo por su cuenta.
      res.json({ success: true, data: { id, replaces: null, editable: false } });
    } catch (err) {
      responderCatalogo(res, err, 'send event');
    }
  });

  app.post('/api/send-product', async (req: Request, res: Response) => {
    const session = getSession(req, res);
    if (!session) return;
    const body = (req.body ?? {}) as any;

    if (typeof body.to !== 'string' || body.to.trim() === '') {
      res.status(400).json({ success: false, error: 'Missing or invalid field: to' });
      return;
    }
    if (typeof body.productId !== 'string' || body.productId.trim() === '') {
      res.status(400).json({ success: false, error: 'Missing or invalid field: productId' });
      return;
    }
    if (typeof body.title !== 'string' || body.title.trim() === '') {
      res.status(400).json({ success: false, error: 'Missing or invalid field: title' });
      return;
    }
    if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price <= 0) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: price (must be a positive number)' });
      return;
    }
    if (typeof body.currency !== 'string' || body.currency.trim().length !== 3) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: currency (3-letter code)' });
      return;
    }
    if (typeof body.imageUrl !== 'string' || !body.imageUrl.startsWith('http')) {
      res.status(400).json({ success: false, error: 'Missing or invalid field: imageUrl (public http(s) URL)' });
      return;
    }

    try {
      const id = await session.messageSender.sendProduct(body.to, {
        productId: body.productId,
        title: body.title,
        description: typeof body.description === 'string' ? body.description : undefined,
        price: body.price,
        salePrice: typeof body.salePrice === 'number' ? body.salePrice : undefined,
        currency: body.currency.toUpperCase(),
        retailerId: typeof body.retailerId === 'string' ? body.retailerId : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
        imageUrl: body.imageUrl,
        businessOwnerJid: typeof body.businessOwnerJid === 'string' ? body.businessOwnerJid : undefined,
        body: typeof body.body === 'string' ? body.body : undefined,
        footer: typeof body.footer === 'string' ? body.footer : undefined,
      });
      res.json({ success: true, data: { id } });
    } catch (err) {
      responderCatalogo(res, err, 'send product');
    }
  });

  // ─── SSE ─────────────────────────────────────────────────────
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

function parseListOpts(req: Request) {
  const q = typeof req.query.q === 'string' && req.query.q ? req.query.q : undefined;
  const rawLimit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
  const limit: number | undefined = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : undefined;
  const rawOffset = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : NaN;
  const offset = !isNaN(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const onlyMyContacts = req.query.onlyMyContacts === 'true';
  const includeGroups = req.query.includeGroups === 'true';
  const rawOrder = req.query.orderBy;
  const orderBy: 'name' | 'updated_at' = rawOrder === 'updated_at' ? 'updated_at' : 'name';
  return { q, limit, offset, onlyMyContacts, includeGroups, orderBy };
}
