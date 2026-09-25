import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createSessionManager } from '../sessions/session-manager';
import { SessionNotFoundError } from '../sessions/types';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { ContactStore } from '../storage/contact-store';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const mockConfig: EnvConfig = {
  instanceName: 'test-legacy',
  maxSessions: 10,
  healthPort: 19990,
  apiPort: 19991,
  logLevel: 'error',
  sessionStore: 'file',
  sessionDir: '',  // set per-test
  webhookEvents: [],
  webhookRetryCount: 0,
  webhookRetryDelay: 0,
  connectOnStartup: false,  // never actually connect to WhatsApp
  qrTimeout: 60000,
  nodeEnv: 'test',
  pollingEnabled: false,
  sseEnabled: false,
  messageBufferSize: 100,
  messageBufferTtlMs: 60000,
  sseHeartbeatMs: 30000,
  autoTyping: false,
  typingDurationMs: 1000,
  autoRead: false,
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:19991',
};

const mockContactStore: ContactStore = {
  upsert: async () => {},
  upsertMany: async () => {},
  list: async () => ({ items: [], total: 0 }),
  setProfilePic: async () => {},
  mergeLid: async () => {},
  purgeSession: async () => {},
};

import type { LabelStore } from '../storage/label-store';
const mockLabelStore: LabelStore = {
  upsertLabel: async () => {},
  listLabels: async () => [],
  getLabel: async () => null,
  addAssociation: async () => {},
  removeAssociation: async () => {},
  getAssociations: async () => ({ chats: [], messages: [] }),
};

const logger = createLogger(mockConfig);

let tmpDir = '';

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'wacore-sm-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Sellado del origen de los mensajes propios.
 *
 * Es el punto donde se decide si un eco es del consumidor o del móvil, y el único sitio donde se
 * puede decidir: el registro de enviados es por sesión y el bus global ya no distingue de
 * cuál viene cada mensaje.
 */
describe('SessionManager — origen de los mensajes propios', () => {
  async function sesionLista(globalBus: ReturnType<typeof createEventBus>) {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: globalBus,
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();
    return { sm, session: sm.get(config.instanceName) };
  }

  function propio(id: string) {
    return {
      key: { remoteJid: '123456@s.whatsapp.net', id, fromMe: true },
      message: { conversation: 'hola' },
    };
  }

  /**
   * Cerrar sesión apaga el cliente pero **no desaloja la sesión del pool**. Si `create()` se
   * limita a devolver lo que encuentra, la conexión queda muerta para siempre: nadie la
   * arranca, no se genera QR nuevo, y la pantalla de Conexiones abre el modal y lo cierra sin
   * nada que enseñar. La única salida era reiniciar WACore entero. Pasó en local el 2026-08-26.
   */
  it('vuelve a arrancar una sesión que se había caído en vez de devolverla muerta', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config, globalEventBus: createEventBus(),
      contactStore: mockContactStore, labelStore: mockLabelStore, logger,
    });

    const primera = await sm.create({ accountId: 'cuenta', userId: '17' });

    // Se simula lo que deja un logout: cliente apagado, sesión aún en el pool.
    const arranques: string[] = [];
    const startOriginal = primera.start;
    (primera as any).start = async () => { arranques.push('start'); return startOriginal.call(primera); };
    (primera as any).getInfo = () => ({
      sessionId: 'cuenta:17', accountId: 'cuenta', userId: '17',
      status: 'logged-out' as any, phoneNumber: null, displayName: null, lastSeenAt: null,
    });

    const segunda = await sm.create({ accountId: 'cuenta', userId: '17' });

    expect(segunda).toBe(primera);
    expect(arranques).toEqual(['start']);
    await sm.stopAll();
  });

  it('no rearranca una sesión que está viva', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config, globalEventBus: createEventBus(),
      contactStore: mockContactStore, labelStore: mockLabelStore, logger,
    });

    const primera = await sm.create({ accountId: 'cuenta', userId: '18' });
    const arranques: string[] = [];
    (primera as any).start = async () => { arranques.push('start'); };
    (primera as any).getInfo = () => ({
      sessionId: 'cuenta:18', accountId: 'cuenta', userId: '18',
      status: 'connected' as any, phoneNumber: null, displayName: null, lastSeenAt: null,
    });

    await sm.create({ accountId: 'cuenta', userId: '18' });

    expect(arranques).toEqual([]);
    await sm.stopAll();
  });

  it('un mensaje entrante no lleva sello de origen', async () => {
    const globalBus = createEventBus();
    const recibidos: any[] = [];
    globalBus.on('message', (m: any) => { recibidos.push(m); });

    const { session } = await sesionLista(globalBus);
    session.localEventBus.emit('message', {
      key: { remoteJid: '123456@s.whatsapp.net', id: 'entrante', fromMe: false },
      message: { conversation: 'hola' },
    } as any);

    expect(recibidos.length).toBe(1);
    expect(recibidos[0]._origin).toBeUndefined();
  });

  it('lo que no salió por la API se sella como device', async () => {
    const globalBus = createEventBus();
    const recibidos: any[] = [];
    globalBus.on('message', (m: any) => { recibidos.push(m); });

    const { session } = await sesionLista(globalBus);
    session.localEventBus.emit('message', propio('escrito-en-el-movil') as any);

    expect(recibidos[0]._origin).toBe('device');
  });

  it('lo que salió por la API se sella como api', async () => {
    const globalBus = createEventBus();
    const recibidos: any[] = [];
    globalBus.on('message', (m: any) => { recibidos.push(m); });

    const { session } = await sesionLista(globalBus);
    session.sentRegistry!.remember('123456@s.whatsapp.net', 'enviado-por-el-crm');
    session.localEventBus.emit('message', propio('enviado-por-el-crm') as any);

    expect(recibidos[0]._origin).toBe('api');
  });

  it('el sello sobrevive a la repetición del eco', async () => {
    const globalBus = createEventBus();
    const recibidos: any[] = [];
    globalBus.on('message', (m: any) => { recibidos.push(m); });

    const { session } = await sesionLista(globalBus);
    session.sentRegistry!.remember('123456@s.whatsapp.net', 'enviado-por-el-crm');
    session.localEventBus.emit('message', propio('enviado-por-el-crm') as any);
    session.localEventBus.emit('message', propio('enviado-por-el-crm') as any);

    // Una reconexión reenvía lo reciente: la segunda copia también es nuestra.
    expect(recibidos.map((m: any) => m._origin)).toEqual(['api', 'api']);
  });

  it('el histórico cruza al bus global con su sesión', async () => {
    const globalBus = createEventBus();
    const recibidos: any[] = [];
    globalBus.on('history.message', (m: any) => { recibidos.push(m); });

    const { session } = await sesionLista(globalBus);
    session.localEventBus.emit('history.message', {
      key: { remoteJid: '123456@s.whatsapp.net', id: 'viejo', fromMe: false },
      message: { conversation: 'de hace meses' },
    } as any);

    expect(recibidos.length).toBe(1);
    expect(recibidos[0]._sessionId).toBe(mockConfig.instanceName);
  });

  it('el histórico no lleva sello de origen', async () => {
    const globalBus = createEventBus();
    const recibidos: any[] = [];
    globalBus.on('history.message', (m: any) => { recibidos.push(m); });

    const { session } = await sesionLista(globalBus);
    session.localEventBus.emit('history.message', {
      key: { remoteJid: '123456@s.whatsapp.net', id: 'viejo-mio', fromMe: true },
      message: { conversation: 'lo escribí yo hace meses' },
    } as any);

    // Al emparejar, el registro de enviados está vacío y todo saldría como escrito a mano. Es lo
    // correcto: en un volcado el consumidor no tiene nada guardado, así que todo tiene que entrar.
    expect(recibidos[0]._origin).toBeUndefined();
  });

  it('el sello conserva la sesión, la cuenta y el usuario', async () => {
    const globalBus = createEventBus();
    const recibidos: any[] = [];
    globalBus.on('message', (m: any) => { recibidos.push(m); });

    const { session } = await sesionLista(globalBus);
    session.sentRegistry!.remember('123456@s.whatsapp.net', 'x');
    session.localEventBus.emit('message', propio('x') as any);

    expect(recibidos[0]._sessionId).toBe(mockConfig.instanceName);
    expect(recibidos[0]._accountId).toBeNull();
    expect(recibidos[0]._userId).toBeNull();
  });
});

describe('SessionManager — file store', () => {
  it('bootstrap creates a legacy session when none exist', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });

    await sm.bootstrap();

    const sessions = sm.list();
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.sessionId).toBe(config.instanceName);
    expect(sessions[0]!.accountId).toBeNull();
    expect(sessions[0]!.userId).toBeNull();
    expect(sessions[0]!.status).toBe('disconnected');
  });

  it('get() returns the legacy session after bootstrap', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();

    const session = sm.get(config.instanceName);
    expect(session).toBeDefined();
    expect(session.sessionId).toBe(config.instanceName);
  });

  it('get() throws SessionNotFoundError for unknown sessionId', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();

    expect(() => sm.get('nonexistent')).toThrow(SessionNotFoundError);
    expect(() => sm.get('nonexistent')).toThrow('Session not found: nonexistent');
  });

  it('getOrLegacy() returns legacy session when no sessionId given', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();

    const session = sm.getOrLegacy();
    expect(session.sessionId).toBe(config.instanceName);
  });

  it('getOrLegacy() throws SessionNotFoundError for an explicit unknown sessionId', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();

    // When a sessionId is explicitly provided but not found, must throw — never silently
    // cross to another tenant's session.
    expect(() => sm.getOrLegacy('not-a-real-session')).toThrow(SessionNotFoundError);
  });

  it('list() returns all sessions', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();

    const list = sm.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(1);
    expect(list[0]!.sessionId).toBe(config.instanceName);
  });

  it('getInfo() includes correct fields', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();

    const info = sm.get(config.instanceName).getInfo();
    expect(info.sessionId).toBe(config.instanceName);
    expect(info.accountId).toBeNull();
    expect(info.userId).toBeNull();
    expect(info.status).toBe('disconnected');
    expect(info.phoneNumber).toBeNull();
    expect(info.displayName).toBeNull();
  });

  it('stopAll() stops all sessions without throwing', async () => {
    const config = { ...mockConfig, sessionDir: tmpDir };
    const sm = createSessionManager({
      config,
      globalEventBus: createEventBus(),
      contactStore: mockContactStore,
      labelStore: mockLabelStore,
      logger,
    });
    await sm.bootstrap();

    await expect(sm.stopAll()).resolves.toBeUndefined();
  });
});
