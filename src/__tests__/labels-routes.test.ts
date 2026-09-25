import { describe, expect, it, afterAll, mock } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import type { LabelStore } from '../storage/label-store';
import { SessionNotFoundError } from '../sessions/types';

const PORT = 19883;

const mockConfig = {
  instanceName: 'test', healthPort: 19884, apiPort: PORT, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  nodeEnv: 'test', autoTyping: false, typingDurationMs: 3000, autoRead: false, apiKey: 'k',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: `http://localhost:${PORT}`,
};
const logger = createLogger(mockConfig);

function createMockSession(): ManagedSession {
  return {
    sessionId: 'test',
    accountId: null,
    userId: null,
    client: {} as any,
    messageSender: {} as any,
    presenceManager: {} as any,
    readReceiptManager: {} as any,
    groupManager: {} as any,
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

describe('Labels routes', () => {
  const labelStore: LabelStore = {
    upsertLabel: mock(async () => {}),
    listLabels: mock(async (_sessionId: string, opts?: any) => {
      const items = [
        { id: '1', name: 'Cliente nuevo', color: 0, deleted: false, predefinedId: '1', source: 'wa' as const },
        { id: '2', name: 'VIP', color: 3, deleted: false, predefinedId: null, source: 'wa' as const },
        { id: '3', name: 'Borrada', color: 0, deleted: true, predefinedId: null, source: 'wa' as const },
      ];
      return opts?.includeDeleted ? items : items.filter(l => !l.deleted);
    }),
    getLabel: mock(async (_sessionId: string, id: string) => {
      if (id === '404') return null;
      return { id, name: 'X', color: 0, deleted: false, predefinedId: null, source: 'wa' as const };
    }),
    addAssociation: mock(async () => {}),
    removeAssociation: mock(async () => {}),
    getAssociations: mock(async () => ({
      chats: ['a@s.whatsapp.net'],
      messages: [{ chatJid: 'a@s.whatsapp.net', messageId: 'M1' }],
    })),
  };
  const session = createMockSession();
  const sessionManager = createMockSessionManager(session);
  const api = createRestApi(PORT, mockConfig, logger, sessionManager, undefined, undefined, undefined, undefined, labelStore);
  api.start();

  afterAll(() => { api.stop(); });

  it('rejects without auth token', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/labels`);
    expect(res.status).toBe(401);
  });

  it('lists non-deleted labels by default', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/labels`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.labels).toHaveLength(2);
    expect(body.data.labels[0].id).toBe('1');
    expect(labelStore.listLabels).toHaveBeenCalledWith('test', { includeDeleted: false });
  });

  it('lists all labels including deleted when includeDeleted=true', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/labels?includeDeleted=true`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.labels).toHaveLength(3);
  });

  it('returns 404 for unknown label associations', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/labels/404/associations`, { headers: authHeaders });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
  });

  it('returns grouped chats and messages for existing label', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/labels/1/associations`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual({
      chats: ['a@s.whatsapp.net'],
      messages: [{ chatJid: 'a@s.whatsapp.net', messageId: 'M1' }],
    });
    expect(labelStore.getAssociations).toHaveBeenCalledWith('test', '1');
  });
});
