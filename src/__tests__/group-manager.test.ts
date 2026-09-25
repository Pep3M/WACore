import { describe, expect, it, mock } from 'bun:test';
import { createGroupManager, InvalidGroupJidError } from '../services/group-manager';
import { createLogger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';

const mockConfig = {
  instanceName: 'test', healthPort: 9977, apiPort: 9978, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:9978',
};
const logger = createLogger(mockConfig);

function createMockSocket() {
  return {
    groupCreate: mock(async (subject: string, participants: string[]) => ({
      id: '120000@g.us', subject, participants: participants.map(jid => ({ id: jid })),
    })),
    groupMetadata: mock(async (jid: string) => ({ id: jid, subject: 'Group' })),
    groupFetchAllParticipating: mock(async () => ({ '120000@g.us': { id: '120000@g.us', subject: 'Group' } })),
    groupUpdateSubject: mock(async () => {}),
    groupUpdateDescription: mock(async () => {}),
    groupSettingUpdate: mock(async () => {}),
    groupParticipantsUpdate: mock(async () => [{ status: '200', jid: '521@s.whatsapp.net', content: {} as any }]),
    groupLeave: mock(async () => {}),
    groupInviteCode: mock(async () => 'ABC123'),
    groupRevokeInvite: mock(async () => 'DEF456'),
    groupAcceptInvite: mock(async () => '120000@g.us'),
    groupGetInviteInfo: mock(async (code: string) => ({ id: '120000@g.us', subject: `From-${code}` })),
  };
}

function createMockClient(socketOverride?: any): BaileysClient {
  return {
    socket: socketOverride === undefined ? createMockSocket() as any : socketOverride,
    start: mock(async () => {}),
    stop: mock(async () => {}),
    sendMessage: mock(async () => ({ key: { id: 'x' } })),
    sendPresenceUpdate: mock(async () => {}),
    getConnectionStatus: mock(() => 'connected' as const),
    getQr: mock(() => null),
    logout: mock(async () => {}),
    connect: mock(async () => {}),
    getContacts: mock(() => []),
    readMessages: mock(async () => {}),
    uploadPreKeysToServerIfRequired: mock(async () => {}),
  };
}

describe('GroupManager', () => {
  it('creates group with normalized participant JIDs', async () => {
    const client = createMockClient();
    const mgr = createGroupManager(client, logger);

    await mgr.create('MyGroup', ['521111', '521222@s.whatsapp.net']);

    expect(client.socket!.groupCreate).toHaveBeenCalledWith(
      'MyGroup',
      ['521111@s.whatsapp.net', '521222@s.whatsapp.net'],
    );
  });

  it('normalizes bare group ids to @g.us', async () => {
    const client = createMockClient();
    const mgr = createGroupManager(client, logger);

    await mgr.metadata('120000');

    expect(client.socket!.groupMetadata).toHaveBeenCalledWith('120000@g.us');
  });

  it('does not double-suffix group JIDs already ending with @g.us', async () => {
    const client = createMockClient();
    const mgr = createGroupManager(client, logger);

    await mgr.metadata('120000@g.us');

    expect(client.socket!.groupMetadata).toHaveBeenCalledWith('120000@g.us');
  });

  it('updates participants with action and normalized JIDs', async () => {
    const client = createMockClient();
    const mgr = createGroupManager(client, logger);

    const results = await mgr.updateParticipants('120000', 'promote', ['521333']);

    expect(client.socket!.groupParticipantsUpdate).toHaveBeenCalledWith(
      '120000@g.us',
      ['521333@s.whatsapp.net'],
      'promote',
    );
    expect(results).toEqual([{ status: '200', jid: '521@s.whatsapp.net' }]);
  });

  it('proxies invite operations', async () => {
    const client = createMockClient();
    const mgr = createGroupManager(client, logger);

    expect(await mgr.inviteCode('120000')).toBe('ABC123');
    expect(await mgr.revokeInvite('120000')).toBe('DEF456');
    expect(await mgr.acceptInvite('CODE')).toBe('120000@g.us');
    const info = await mgr.getInviteInfo('CODE');
    expect(info.subject).toBe('From-CODE');
  });

  it('rejects group JIDs that do not end with @g.us', async () => {
    const client = createMockClient();
    const mgr = createGroupManager(client, logger);

    await expect(mgr.metadata('521@s.whatsapp.net')).rejects.toBeInstanceOf(InvalidGroupJidError);
    await expect(mgr.updateSubject('521@lid', 'x')).rejects.toBeInstanceOf(InvalidGroupJidError);
    await expect(mgr.leave('')).rejects.toBeInstanceOf(InvalidGroupJidError);
  });

  it('throws when socket is not connected', async () => {
    const client = createMockClient(null);
    const mgr = createGroupManager(client, logger);

    await expect(mgr.metadata('120000')).rejects.toThrow('WhatsApp socket not connected');
    await expect(mgr.create('X', ['1'])).rejects.toThrow('WhatsApp socket not connected');
  });
});
