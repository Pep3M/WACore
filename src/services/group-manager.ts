import type { GroupMetadata } from 'baileys';
import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';
import type { GroupParticipantAction, GroupSetting } from '../types';

export interface GroupParticipantResult {
  status: string;
  jid: string | undefined;
}

export interface GroupManager {
  create(subject: string, participants: string[]): Promise<GroupMetadata>;
  metadata(jid: string): Promise<GroupMetadata>;
  listAll(): Promise<{ [jid: string]: GroupMetadata }>;
  updateSubject(jid: string, subject: string): Promise<void>;
  updateDescription(jid: string, description?: string): Promise<void>;
  updateSettings(jid: string, setting: GroupSetting): Promise<void>;
  updateParticipants(jid: string, action: GroupParticipantAction, participants: string[]): Promise<GroupParticipantResult[]>;
  leave(jid: string): Promise<void>;
  inviteCode(jid: string): Promise<string | undefined>;
  revokeInvite(jid: string): Promise<string | undefined>;
  acceptInvite(code: string): Promise<string | undefined>;
  getInviteInfo(code: string): Promise<GroupMetadata>;
}

export class InvalidGroupJidError extends Error {
  constructor(jid: string) {
    super(`Invalid group JID: ${jid}`);
    this.name = 'InvalidGroupJidError';
  }
}

function normalizeGroupJid(jid: string): string {
  if (!jid) throw new InvalidGroupJidError(jid);
  if (jid.includes('@')) {
    if (!jid.endsWith('@g.us')) throw new InvalidGroupJidError(jid);
    return jid;
  }
  return `${jid}@g.us`;
}

function normalizeUserJid(jid: string): string {
  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
}

export function createGroupManager(client: BaileysClient, logger: Logger): GroupManager {
  function requireSocket() {
    if (!client.socket) throw new Error('WhatsApp socket not connected');
    return client.socket;
  }

  return {
    async create(subject, participants) {
      const sock = requireSocket();
      const normalized = participants.map(normalizeUserJid);
      logger.debug('Creating group', { subject, participants: normalized });
      return sock.groupCreate(subject, normalized);
    },

    async metadata(jid) {
      const sock = requireSocket();
      return sock.groupMetadata(normalizeGroupJid(jid));
    },

    async listAll() {
      const sock = requireSocket();
      return sock.groupFetchAllParticipating();
    },

    async updateSubject(jid, subject) {
      const sock = requireSocket();
      await sock.groupUpdateSubject(normalizeGroupJid(jid), subject);
    },

    async updateDescription(jid, description) {
      const sock = requireSocket();
      await sock.groupUpdateDescription(normalizeGroupJid(jid), description);
    },

    async updateSettings(jid, setting) {
      const sock = requireSocket();
      await sock.groupSettingUpdate(normalizeGroupJid(jid), setting);
    },

    async updateParticipants(jid, action, participants) {
      const sock = requireSocket();
      const normalized = participants.map(normalizeUserJid);
      const results = await sock.groupParticipantsUpdate(normalizeGroupJid(jid), normalized, action);
      return results.map(r => ({ status: r.status, jid: r.jid }));
    },

    async leave(jid) {
      const sock = requireSocket();
      await sock.groupLeave(normalizeGroupJid(jid));
    },

    async inviteCode(jid) {
      const sock = requireSocket();
      return sock.groupInviteCode(normalizeGroupJid(jid));
    },

    async revokeInvite(jid) {
      const sock = requireSocket();
      return sock.groupRevokeInvite(normalizeGroupJid(jid));
    },

    async acceptInvite(code) {
      const sock = requireSocket();
      return sock.groupAcceptInvite(code);
    },

    async getInviteInfo(code) {
      const sock = requireSocket();
      return sock.groupGetInviteInfo(code);
    },
  };
}
