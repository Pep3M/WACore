import { describe, expect, it, afterAll, mock } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import type { GroupManager } from '../services/group-manager';
import { SessionNotFoundError } from '../sessions/types';

const PORT = 19881;

const mockConfig = {
  instanceName: 'test', healthPort: 19882, apiPort: PORT, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, autoRead: false, apiKey: 'k',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: `http://localhost:${PORT}`,
};
const logger = createLogger(mockConfig);

function createGroupManagerSpies() {
  const groupManager: GroupManager = {
    create: mock(async (subject: string) => ({ id: '120000@g.us', subject } as any)),
    metadata: mock(async (jid: string) => ({ id: jid, subject: 'G' } as any)),
    listAll: mock(async () => ({ '120000@g.us': { id: '120000@g.us', subject: 'G' } as any })),
    updateSubject: mock(async () => {}),
    updateDescription: mock(async () => {}),
    updateSettings: mock(async () => {}),
    updateParticipants: mock(async () => [{ status: '200', jid: '1@s.whatsapp.net' }]),
    leave: mock(async () => {}),
    inviteCode: mock(async () => 'ABC'),
    revokeInvite: mock(async () => 'DEF'),
    acceptInvite: mock(async () => '120000@g.us'),
    getInviteInfo: mock(async (code: string) => ({ id: '120000@g.us', subject: code } as any)),
  };
  return groupManager;
}

function createMockSession(groupManager: GroupManager): ManagedSession {
  return {
    sessionId: 'test',
    accountId: null,
    userId: null,
    client: {} as any,
    messageSender: {} as any,
    presenceManager: {} as any,
    readReceiptManager: {} as any,
    groupManager,
    profileManager: {} as any,
    labelManager: {} as any,
    chatManager: {} as any,
    localEventBus: createEventBus(),
    start: async () => {},
    stop: async () => {},
    logout: async () => {},
    getInfo: () => ({ sessionId: 'test', accountId: null, userId: null, status: 'connected' as any, phoneNumber: null, displayName: null, lastSeenAt: null }),
  };
}

function createMockSessionManager(session: ManagedSession, notFound = false): SessionManager {
  return {
    bootstrap: async () => {},
    get: () => { if (notFound) throw new SessionNotFoundError('x'); return session; },
    getOrLegacy: () => { if (notFound) throw new SessionNotFoundError('x'); return session; },
    create: async () => session,
    destroy: async () => {},
    list: () => [session.getInfo()],
    stopAll: async () => {},
  };
}

const authHeaders = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };

describe('Groups routes', () => {
  const groupManager = createGroupManagerSpies();
  const session = createMockSession(groupManager);
  const sessionManager = createMockSessionManager(session);
  const api = createRestApi(PORT, mockConfig, logger, sessionManager);
  api.start();

  afterAll(() => { api.stop(); });

  it('creates a group', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ subject: 'My Group', participants: ['521111'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.subject).toBe('My Group');
    expect(groupManager.create).toHaveBeenCalledWith('My Group', ['521111']);
  });

  it('rejects create without required fields', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ subject: 'Only subject' }),
    });
    expect(res.status).toBe(400);
  });

  it('lists all groups', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.groups['120000@g.us'].subject).toBe('G');
  });

  it('fetches metadata by jid', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/120000@g.us`, { headers: authHeaders });
    expect(res.status).toBe(200);
    expect(groupManager.metadata).toHaveBeenCalledWith('120000@g.us');
  });

  it('updates participants', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/120000/participants`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action: 'add', participants: ['521999'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.results).toEqual([{ status: '200', jid: '1@s.whatsapp.net' }]);
    expect(groupManager.updateParticipants).toHaveBeenCalledWith('120000', 'add', ['521999']);
  });

  it('rejects invalid participant action', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/120000/participants`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ action: 'nope', participants: ['521999'] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns invite code with URL', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/120000/invite-code`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.code).toBe('ABC');
    expect(body.data.url).toBe('https://chat.whatsapp.com/ABC');
  });

  it('accepts an invite by code', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/invite/accept`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ code: 'CODE' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.jid).toBe('120000@g.us');
  });

  it('leaves a group', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/120000/leave`, {
      method: 'POST',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(groupManager.leave).toHaveBeenCalledWith('120000');
  });

  it('rejects non-string participants', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ subject: 'X', participants: [123, 456] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-string subject', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ subject: 42, participants: ['521'] }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only subject', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ subject: '   ', participants: ['521'] }),
    });
    expect(res.status).toBe(400);
  });

  it('caps participants to MAX_PARTICIPANTS', async () => {
    const many = Array.from({ length: 300 }, (_, i) => `52111${i}`);
    const res = await fetch(`http://localhost:${PORT}/api/groups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ subject: 'X', participants: many }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH description requires the field explicitly', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/120000/description`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH description accepts empty string to clear', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/groups/120000/description`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ description: '' }),
    });
    expect(res.status).toBe(200);
    expect(groupManager.updateDescription).toHaveBeenCalledWith('120000', '');
  });

  it('maps socket-not-connected to 503 when service throws it', async () => {
    // Replace the mock to simulate a disconnected socket
    const notConnected = { ...groupManager, metadata: async () => { throw new Error('WhatsApp socket not connected'); } };
    const tmpSession = createMockSession(notConnected as any);
    const tmpMgr = createMockSessionManager(tmpSession);
    const PORT3 = PORT + 20;
    const cfg3 = { ...mockConfig, apiPort: PORT3, mediaBaseUrl: `http://localhost:${PORT3}` };
    const tmpApi = createRestApi(PORT3, cfg3, logger, tmpMgr);
    tmpApi.start();
    try {
      const res = await fetch(`http://localhost:${PORT3}/api/groups/120000`, { headers: authHeaders });
      expect(res.status).toBe(503);
    } finally {
      tmpApi.stop();
    }
  });
});

describe('Groups routes — session not found', () => {
  const PORT2 = PORT + 10;
  const cfg = { ...mockConfig, apiPort: PORT2, mediaBaseUrl: `http://localhost:${PORT2}` };
  const groupManager = createGroupManagerSpies();
  const session = createMockSession(groupManager);
  const sessionManager = createMockSessionManager(session, true);
  const api = createRestApi(PORT2, cfg, logger, sessionManager);
  api.start();
  afterAll(() => { api.stop(); });

  it('returns 404 when session cannot be resolved', async () => {
    const res = await fetch(`http://localhost:${PORT2}/api/groups/120000`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });
});
