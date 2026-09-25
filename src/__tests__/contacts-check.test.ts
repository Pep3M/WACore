import { describe, expect, it, mock, afterAll } from 'bun:test';
import { createProfileManager } from '../services/profile-manager';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { BaileysClient } from '../baileys/client';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import type { ProfileManager } from '../services/profile-manager';

const PORT = 19921;

const mockConfig = {
  instanceName: 'test', healthPort: 19922, apiPort: PORT, logLevel: 'error' as const,
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

/**
 * Reproduce el contrato real de Baileys, que es lo que hace útil a este doble:
 * `onWhatsApp` es variádico, **omite de la respuesta los que no existen** y
 * devuelve el JID canónico, que no tiene por qué ser el que se preguntó.
 */
function crearSocket(enLaRed: Record<string, string>, opciones: { devuelveUndefined?: boolean } = {}) {
  const llamadas: string[][] = [];
  const onWhatsApp = mock(async (...numeros: string[]) => {
    llamadas.push(numeros);
    if (opciones.devuelveUndefined) return undefined as never;
    return numeros
      .filter((n) => enLaRed[n] !== undefined)
      .map((n) => ({ jid: enLaRed[n]!, exists: true }));
  });
  return { socket: { onWhatsApp } as any, llamadas, onWhatsApp };
}

function crearCliente(socket: any): BaileysClient {
  return { socket } as unknown as BaileysClient;
}

describe('checkNumbers', () => {
  it('devuelve una fila por número pedido, en el mismo orden', async () => {
    const { socket } = crearSocket({ '34600111222': '34600111222@s.whatsapp.net' });
    const pm = createProfileManager(crearCliente(socket), logger);

    const r = await pm.checkNumbers(['34600111222', '34600999888']);

    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ input: '34600111222', jid: '34600111222@s.whatsapp.net', exists: true });
    expect(r[1]).toEqual({ input: '34600999888', jid: null, exists: false });
  });

  it('no omite los que no existen: los marca exists=false', async () => {
    const { socket } = crearSocket({});
    const pm = createProfileManager(crearCliente(socket), logger);

    const r = await pm.checkNumbers(['34600111222', '34600333444']);

    expect(r.map((x) => x.exists)).toEqual([false, false]);
    expect(r.map((x) => x.input)).toEqual(['34600111222', '34600333444']);
  });

  it('aguanta que Baileys devuelva undefined en vez de una lista', async () => {
    const { socket } = crearSocket({ '34600111222': '34600111222@s.whatsapp.net' }, { devuelveUndefined: true });
    const pm = createProfileManager(crearCliente(socket), logger);

    const r = await pm.checkNumbers(['34600111222']);

    expect(r[0]?.exists).toBe(false);
  });

  it('acepta el número con formato y lo devuelve tal cual lo pidieron', async () => {
    const { socket } = crearSocket({ '34600111222': '34600111222@s.whatsapp.net' });
    const pm = createProfileManager(crearCliente(socket), logger);

    const r = await pm.checkNumbers(['+34 600 111 222']);

    expect(r[0]?.input).toBe('+34 600 111 222');
    expect(r[0]?.exists).toBe(true);
  });

  it('pregunta una sola vez por los repetidos, pero contesta a cada fila', async () => {
    const { socket, llamadas } = crearSocket({ '34600111222': '34600111222@s.whatsapp.net' });
    const pm = createProfileManager(crearCliente(socket), logger);

    const r = await pm.checkNumbers(['34600111222', '+34600111222', '34600111222']);

    expect(r).toHaveLength(3);
    expect(r.every((x) => x.exists)).toBe(true);
    expect(llamadas[0]).toEqual(['34600111222']);
  });

  it('no gasta consulta en lo que no puede ser un teléfono', async () => {
    const { socket, llamadas } = crearSocket({});
    const pm = createProfileManager(crearCliente(socket), logger);

    const r = await pm.checkNumbers(['12', 'sin dígitos']);

    expect(r.map((x) => x.exists)).toEqual([false, false]);
    expect(llamadas).toHaveLength(0);
  });

  it('encuentra al que WhatsApp devuelve con otro JID, repreguntando de uno en uno', async () => {
    // México: se pregunta por 5215512345678 y la red responde 525512345678.
    // Por lote es indistinguible de «no tiene WhatsApp»; suelto, es inequívoco.
    const pedido = '5215512345678';
    const canonico = '525512345678@s.whatsapp.net';
    const llamadas: string[][] = [];
    const socket = {
      onWhatsApp: mock(async (...numeros: string[]) => {
        llamadas.push(numeros);
        // En lote no lo reconoce; suelto sí.
        if (numeros.length === 1 && numeros[0] === pedido) return [{ jid: canonico, exists: true }];
        return [];
      }),
    } as any;
    const pm = createProfileManager(crearCliente(socket), logger);

    const r = await pm.checkNumbers([pedido]);

    expect(r[0]?.exists).toBe(true);
    expect(r[0]?.jid).toBe(canonico);
    expect(llamadas).toHaveLength(2);
  });

  it('no repregunta por los que ya encontró en el lote', async () => {
    const { socket, llamadas } = crearSocket({
      '34600111222': '34600111222@s.whatsapp.net',
      '34600333444': '34600333444@s.whatsapp.net',
    });
    const pm = createProfileManager(crearCliente(socket), logger);

    await pm.checkNumbers(['34600111222', '34600333444']);

    expect(llamadas).toHaveLength(1);
  });

  it('revienta si la línea no está conectada', async () => {
    const pm = createProfileManager(crearCliente(null), logger);
    await expect(pm.checkNumbers(['34600111222'])).rejects.toThrow('WhatsApp socket not connected');
  });
});

// ─── Ruta HTTP ──────────────────────────────────────────────

function crearSesion(profileManager: ProfileManager): ManagedSession {
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

function crearSessionManager(session: ManagedSession): SessionManager {
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

const cabeceras = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };

describe('POST /api/contacts/check', () => {
  const checkNumbers = mock(async (numbers: string[]) =>
    numbers.map((n) => ({ input: n, jid: `${n}@s.whatsapp.net`, exists: true })),
  );
  const profileManager = {
    getMe: mock(async () => ({}) as any),
    getContact: mock(async () => ({}) as any),
    checkNumbers,
    getPictureUrl: mock(async () => null),
    updateName: mock(async () => {}),
    updateStatus: mock(async () => {}),
    updatePicture: mock(async () => {}),
    removePicture: mock(async () => {}),
  } as ProfileManager;

  const api = createRestApi(PORT, mockConfig, logger, crearSessionManager(crearSesion(profileManager)));
  api.start();
  afterAll(() => { api.stop(); });

  const pedir = (body: unknown) =>
    fetch(`http://localhost:${PORT}/api/contacts/check`, {
      method: 'POST', headers: cabeceras, body: JSON.stringify(body),
    });

  it('devuelve los resultados', async () => {
    const res = await pedir({ numbers: ['34600111222'] });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.success).toBe(true);
    expect(json.data.total).toBe(1);
    expect(json.data.results[0].exists).toBe(true);
  });

  it('rechaza más de 200 números', async () => {
    const res = await pedir({ numbers: Array.from({ length: 201 }, (_, i) => `3460000${i}`) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toContain('max 200');
  });

  it('acepta exactamente 200', async () => {
    const res = await pedir({ numbers: Array.from({ length: 200 }, (_, i) => `3460000${i}`) });
    expect(res.status).toBe(200);
  });

  it('rechaza una lista vacía', async () => {
    expect((await pedir({ numbers: [] })).status).toBe(400);
  });

  it('rechaza que falte el campo', async () => {
    expect((await pedir({})).status).toBe(400);
  });

  it('rechaza entradas que no son cadenas', async () => {
    const res = await pedir({ numbers: ['34600111222', 12345] });
    expect(res.status).toBe(400);
  });

  it('responde 503 y no 500 cuando la línea está caída', async () => {
    checkNumbers.mockImplementationOnce(async () => { throw new Error('WhatsApp socket not connected'); });
    const res = await pedir({ numbers: ['34600111222'] });
    expect(res.status).toBe(503);
  });
});
