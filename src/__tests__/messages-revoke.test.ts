import { describe, expect, it, afterAll, mock } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import type { MessageSender } from '../services/message-sender';

const PORT = 19883;

const mockConfig = {
  instanceName: 'test', healthPort: 19884, apiPort: PORT, logLevel: 'error' as const,
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

function createMessageSenderSpy(): MessageSender {
  return {
    sendText: mock(async () => 'msg-id'),
    sendMedia: mock(async () => 'msg-id'),
    sendSticker: mock(async () => 'msg-id'),
    sendLocation: mock(async () => 'msg-id'),
    sendContact: mock(async () => 'msg-id'),
    sendPtt: mock(async () => 'msg-id'),
    sendList: mock(async () => 'msg-id'),
    sendButtons: mock(async () => 'msg-id'),
    revoke: mock(async () => {}),
    edit: mock(async () => "EDIT1"),
    pin: mock(async () => "PIN1"),
    react: mock(async () => {}),
    forward: mock(async () => []),
  };
}

function createMockSession(messageSender: MessageSender): ManagedSession {
  return {
    sessionId: 'test',
    accountId: null,
    userId: null,
    client: {} as any,
    messageSender,
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

function createMockSessionManager(session: ManagedSession): SessionManager {
  return {
    bootstrap: async () => {},
    get: () => session,
    getOrLegacy: () => session,
    create: async () => session,
    destroy: async () => {},
    list: () => [session.getInfo()],
    stopAll: async () => {},
  };
}

const authHeaders = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };

describe('DELETE /api/messages/:chatId/:messageId', () => {
  const messageSender = createMessageSenderSpy();
  const session = createMockSession(messageSender);
  const sessionManager = createMockSessionManager(session);
  const api = createRestApi(PORT, mockConfig, logger, sessionManager);
  api.start();

  afterAll(() => { api.stop(); });

  it('revokes own message with defaults', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/messages/5215512345678/MSG1`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ revoked: true, chatId: '5215512345678', messageId: 'MSG1' });
    expect(messageSender.revoke).toHaveBeenCalledWith('5215512345678', 'MSG1', {
      fromMe: undefined,
      participant: undefined,
    });
  });

  it('forwards fromMe and participant from body', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/messages/120000%40g.us/MSG2`, {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ fromMe: false, participant: '52111@s.whatsapp.net' }),
    });
    expect(res.status).toBe(200);
    expect(messageSender.revoke).toHaveBeenCalledWith('120000@g.us', 'MSG2', {
      fromMe: false,
      participant: '52111@s.whatsapp.net',
    });
  });

  it('rejects non-boolean fromMe', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/messages/521/MSG3`, {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ fromMe: 'yes' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('fromMe');
  });

  it('rejects non-string participant', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/messages/521/MSG4`, {
      method: 'DELETE',
      headers: authHeaders,
      body: JSON.stringify({ participant: 42 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('participant');
  });

  it('returns 500 when the sender throws', async () => {
    const failingSender: MessageSender = {
      sendText: mock(async () => ''),
      sendMedia: mock(async () => ''),
      sendSticker: mock(async () => ''),
      sendLocation: mock(async () => ''),
      sendContact: mock(async () => ''),
      sendPtt: mock(async () => ''),
      sendList: mock(async () => ''),
      sendButtons: mock(async () => ''),
      revoke: mock(async () => { throw new Error('baileys down'); }),
      edit: mock(async () => "EDIT1"),
      pin: mock(async () => "PIN1"),
      react: mock(async () => {}),
      forward: mock(async () => []),
    };
    const localSession = createMockSession(failingSender);
    const localMgr = createMockSessionManager(localSession);
    const localApi = createRestApi(PORT + 1, mockConfig, logger, localMgr);
    localApi.start();
    try {
      const res = await fetch(`http://localhost:${PORT + 1}/api/messages/521/MSG5`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      expect(res.status).toBe(500);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('baileys down');
    } finally {
      localApi.stop();
    }
  });
});
