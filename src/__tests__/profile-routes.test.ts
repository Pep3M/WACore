import { describe, expect, it, afterAll, mock } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import type { ProfileManager, ProfileMeSnapshot, ContactProfileSnapshot } from '../services/profile-manager';
import { SessionNotFoundError } from '../sessions/types';

const PORT = 19891;

const mockConfig = {
  instanceName: 'test', healthPort: 19892, apiPort: PORT, logLevel: 'error' as const,
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

const meSnapshot: ProfileMeSnapshot = {
  jid: '5215500000000@s.whatsapp.net',
  phone: '5215500000000',
  name: 'WACore Bot',
  status: 'available',
  picture: 'https://media.whatsapp.net/self.jpg',
};

const contactSnapshot: ContactProfileSnapshot = {
  jid: '34600000000@s.whatsapp.net',
  exists: true,
  picture: 'https://media.whatsapp.net/contact.jpg',
  status: 'busy',
  businessProfile: null,
};

function createProfileManagerSpies() {
  const profileManager: ProfileManager = {
    getMe: mock(async () => meSnapshot),
    getContact: mock(async () => contactSnapshot),
    checkNumbers: mock(async () => []),
    getPictureUrl: mock(async () => 'https://media.whatsapp.net/pic.jpg'),
    updateName: mock(async () => {}),
    updateStatus: mock(async () => {}),
    updatePicture: mock(async () => {}),
    removePicture: mock(async () => {}),
  };
  return profileManager;
}

function createMockSession(profileManager: ProfileManager): ManagedSession {
  return {
    sessionId: 'test',
    accountId: null,
    userId: null,
    client: {} as any,
    messageSender: {} as any,
    presenceManager: {} as any,
    readReceiptManager: {} as any,
    groupManager: {} as any,
    profileManager,
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

describe('Profile routes', () => {
  const profileManager = createProfileManagerSpies();
  const session = createMockSession(profileManager);
  const sessionManager = createMockSessionManager(session);
  const api = createRestApi(PORT, mockConfig, logger, sessionManager);
  api.start();
  afterAll(() => { api.stop(); });

  it('GET /api/profile/me returns the snapshot', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toEqual(meSnapshot);
  });

  it('GET /api/profile/:jid returns contact profile', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/34600000000@s.whatsapp.net`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data).toEqual(contactSnapshot);
    expect(profileManager.getContact).toHaveBeenCalledWith('34600000000@s.whatsapp.net');
  });

  it('GET /api/profile/:jid/picture with default type=image', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/34600000000/picture`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.url).toBe('https://media.whatsapp.net/pic.jpg');
    expect(profileManager.getPictureUrl).toHaveBeenCalledWith('34600000000', 'image');
  });

  it('GET /api/profile/:jid/picture?type=preview passes through', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/34600000000/picture?type=preview`, { headers: authHeaders });
    expect(res.status).toBe(200);
    expect(profileManager.getPictureUrl).toHaveBeenCalledWith('34600000000', 'preview');
  });

  it('GET /api/profile/:jid/picture rejects invalid type', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/34600000000/picture?type=huge`, { headers: authHeaders });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/profile/me/name updates the name', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/name`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: '  Nuevo Nombre  ' }),
    });
    expect(res.status).toBe(200);
    expect(profileManager.updateName).toHaveBeenCalledWith('Nuevo Nombre');
  });

  it('PATCH /api/profile/me/name rejects empty', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/name`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ name: '   ' }),
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/profile/me/status accepts empty string to clear', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ status: '' }),
    });
    expect(res.status).toBe(200);
    expect(profileManager.updateStatus).toHaveBeenCalledWith('');
  });

  it('PATCH /api/profile/me/status rejects missing field', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/profile/me/picture accepts imageUrl', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/picture`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ imageUrl: 'https://example.com/pic.png' }),
    });
    expect(res.status).toBe(200);
    expect(profileManager.updatePicture).toHaveBeenCalledWith({ url: 'https://example.com/pic.png' });
  });

  it('PUT /api/profile/me/picture accepts base64 data URI', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const b64 = png.toString('base64');
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/picture`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ imageData: `data:image/png;base64,${b64}` }),
    });
    expect(res.status).toBe(200);
    const calls = (profileManager.updatePicture as any).mock.calls;
    const lastArg = calls[calls.length - 1][0];
    expect(Buffer.isBuffer(lastArg)).toBe(true);
    expect((lastArg as Buffer).equals(png)).toBe(true);
  });

  it('PUT /api/profile/me/picture rejects both fields at once', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/picture`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ imageUrl: 'https://x/p.png', imageData: 'AAAA' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/profile/me/picture rejects missing fields', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/picture`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/profile/me/picture rejects oversize image with 413', async () => {
    // 6 MB of data → > MAX_PICTURE_BYTES (5 MB)
    const big = Buffer.alloc(6 * 1024 * 1024, 0x41).toString('base64');
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/picture`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ imageData: big }),
    });
    expect(res.status).toBe(413);
  });

  it('DELETE /api/profile/me/picture removes the picture', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/profile/me/picture`, {
      method: 'DELETE',
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    expect(profileManager.removePicture).toHaveBeenCalled();
  });

  it('maps socket-not-connected to 503', async () => {
    const disconnected: ProfileManager = {
      ...createProfileManagerSpies(),
      getMe: async () => { throw new Error('WhatsApp socket not connected'); },
    };
    const tmpSession = createMockSession(disconnected);
    const tmpMgr = createMockSessionManager(tmpSession);
    const PORT3 = PORT + 5;
    const cfg = { ...mockConfig, apiPort: PORT3, mediaBaseUrl: `http://localhost:${PORT3}` };
    const tmpApi = createRestApi(PORT3, cfg, logger, tmpMgr);
    tmpApi.start();
    try {
      const res = await fetch(`http://localhost:${PORT3}/api/profile/me`, { headers: authHeaders });
      expect(res.status).toBe(503);
    } finally {
      tmpApi.stop();
    }
  });
});

describe('Profile routes — session not found', () => {
  const PORT2 = PORT + 10;
  const cfg = { ...mockConfig, apiPort: PORT2, mediaBaseUrl: `http://localhost:${PORT2}` };
  const session = createMockSession(createProfileManagerSpies());
  const sessionManager = createMockSessionManager(session, true);
  const api = createRestApi(PORT2, cfg, logger, sessionManager);
  api.start();
  afterAll(() => { api.stop(); });

  it('returns 404 when session cannot be resolved', async () => {
    const res = await fetch(`http://localhost:${PORT2}/api/profile/me`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });
});
