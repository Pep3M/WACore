import type { Application, Request, Response } from 'express';
import type { SessionManager } from '../sessions/session-manager';
import type { Logger } from '../utils/logger';
import type {
  AcceptGroupInviteRequest,
  CreateGroupRequest,
  GroupParticipantAction,
  GroupSetting,
  UpdateGroupDescriptionRequest,
  UpdateGroupParticipantsRequest,
  UpdateGroupSettingsRequest,
  UpdateGroupSubjectRequest,
} from '../types';
import { getSession } from './session-resolver';
import { InvalidGroupJidError } from '../services/group-manager';

const VALID_ACTIONS: readonly GroupParticipantAction[] = ['add', 'remove', 'promote', 'demote'];
const VALID_SETTINGS: readonly GroupSetting[] = ['announcement', 'not_announcement', 'locked', 'unlocked'];
const MAX_PARTICIPANTS = 256;

function bad(res: Response, error: string): void {
  res.status(400).json({ success: false, error });
}

function fail(logger: Logger, res: Response, err: unknown, context: string): void {
  if (err instanceof InvalidGroupJidError) {
    res.status(400).json({ success: false, error: err.message });
    return;
  }
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
    bad(res, 'Missing or invalid group JID in path');
    return null;
  }
  return raw;
}

function validateParticipants(res: Response, raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    bad(res, 'Missing required field: participants[]');
    return null;
  }
  if (raw.length > MAX_PARTICIPANTS) {
    bad(res, `Too many participants (max ${MAX_PARTICIPANTS})`);
    return null;
  }
  const out: string[] = [];
  for (const p of raw) {
    if (!isNonEmptyString(p)) {
      bad(res, 'participants[] must be non-empty strings');
      return null;
    }
    out.push(p);
  }
  return out;
}

export function registerGroupRoutes(app: Application, sessionManager: SessionManager, logger: Logger): void {
  // Create
  app.post('/api/groups', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const body = (req.body ?? {}) as CreateGroupRequest;
    if (!isNonEmptyString(body.subject)) return bad(res, 'Missing or invalid field: subject');
    const participants = validateParticipants(res, body.participants);
    if (!participants) return;
    try {
      const metadata = await session.groupManager.create(body.subject.trim(), participants);
      res.json({ success: true, data: metadata });
    } catch (err) {
      fail(logger, res, err, 'groupCreate');
    }
  });

  // List all participating
  app.get('/api/groups', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    try {
      const groups = await session.groupManager.listAll();
      res.json({ success: true, data: { groups } });
    } catch (err) {
      fail(logger, res, err, 'groupListAll');
    }
  });

  // Invite: accept (must be registered before /:jid to avoid capture)
  app.post('/api/groups/invite/accept', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const body = (req.body ?? {}) as AcceptGroupInviteRequest;
    if (!isNonEmptyString(body.code)) return bad(res, 'Missing or invalid field: code');
    try {
      const jid = await session.groupManager.acceptInvite(body.code);
      res.json({ success: true, data: { jid } });
    } catch (err) {
      fail(logger, res, err, 'groupAcceptInvite');
    }
  });

  // Invite: info
  app.get('/api/groups/invite/:code', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const code = typeof req.params.code === 'string' ? req.params.code : '';
    if (!code) return bad(res, 'Missing invite code');
    try {
      const metadata = await session.groupManager.getInviteInfo(code);
      res.json({ success: true, data: metadata });
    } catch (err) {
      fail(logger, res, err, 'groupGetInviteInfo');
    }
  });

  // Metadata
  app.get('/api/groups/:jid', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    try {
      const metadata = await session.groupManager.metadata(jid);
      res.json({ success: true, data: metadata });
    } catch (err) {
      fail(logger, res, err, 'groupMetadata');
    }
  });

  // Subject
  app.patch('/api/groups/:jid/subject', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    const body = (req.body ?? {}) as UpdateGroupSubjectRequest;
    if (!isNonEmptyString(body.subject)) return bad(res, 'Missing or invalid field: subject');
    try {
      await session.groupManager.updateSubject(jid, body.subject.trim());
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'groupUpdateSubject');
    }
  });

  // Description — field must be explicitly present (string or empty string to clear)
  app.patch('/api/groups/:jid/description', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    const body = req.body as UpdateGroupDescriptionRequest | undefined;
    if (!body || !('description' in body) || typeof body.description !== 'string') {
      return bad(res, 'Missing or invalid field: description (must be a string; empty string clears)');
    }
    try {
      await session.groupManager.updateDescription(jid, body.description);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'groupUpdateDescription');
    }
  });

  // Settings
  app.patch('/api/groups/:jid/settings', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    const body = (req.body ?? {}) as UpdateGroupSettingsRequest;
    if (!body.setting || !VALID_SETTINGS.includes(body.setting)) {
      return bad(res, `Invalid setting. Must be one of: ${VALID_SETTINGS.join(', ')}`);
    }
    try {
      await session.groupManager.updateSettings(jid, body.setting);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'groupSettingUpdate');
    }
  });

  // Participants
  app.post('/api/groups/:jid/participants', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    const body = (req.body ?? {}) as UpdateGroupParticipantsRequest;
    if (!body.action || !VALID_ACTIONS.includes(body.action)) {
      return bad(res, `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`);
    }
    const participants = validateParticipants(res, body.participants);
    if (!participants) return;
    try {
      const results = await session.groupManager.updateParticipants(jid, body.action, participants);
      res.json({ success: true, data: { results } });
    } catch (err) {
      fail(logger, res, err, 'groupParticipantsUpdate');
    }
  });

  // Leave
  app.post('/api/groups/:jid/leave', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    try {
      await session.groupManager.leave(jid);
      res.json({ success: true });
    } catch (err) {
      fail(logger, res, err, 'groupLeave');
    }
  });

  // Invite code: get
  app.get('/api/groups/:jid/invite-code', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    try {
      const code = await session.groupManager.inviteCode(jid);
      const url = code ? `https://chat.whatsapp.com/${code}` : null;
      res.json({ success: true, data: { code, url } });
    } catch (err) {
      fail(logger, res, err, 'groupInviteCode');
    }
  });

  // Invite code: revoke
  app.post('/api/groups/:jid/invite-code/revoke', async (req: Request, res: Response) => {
    const session = getSession(req, res, sessionManager);
    if (!session) return;
    const jid = validateJidParam(res, req.params.jid);
    if (!jid) return;
    try {
      const code = await session.groupManager.revokeInvite(jid);
      const url = code ? `https://chat.whatsapp.com/${code}` : null;
      res.json({ success: true, data: { code, url } });
    } catch (err) {
      fail(logger, res, err, 'groupRevokeInvite');
    }
  });
}
