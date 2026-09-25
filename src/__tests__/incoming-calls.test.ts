import { describe, expect, it, mock, afterEach } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createLogger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from '../storage/session-store';

/**
 * Llamadas entrantes.
 *
 * El consumidor no atiende llamadas, y eso no va a cambiar. Lo que sí importa es que **quede rastro en
 * la conversación**: sin esto el agente ve un hueco donde el cliente intentó hablar con él, y no
 * hay forma de saber que hubo un intento.
 *
 * De una misma llamada llegan varios eventos con el mismo `id` (`offer` al sonar, y después
 * `accept`, `reject`, `timeout` o `terminate`), así que el consumidor tiene que tratarlos como
 * actualizaciones de un registro y no como llamadas distintas.
 */

const testConfig: EnvConfig = {
  instanceName: 'calls-test',
  healthPort: 19981,
  apiPort: 19982,
  logLevel: 'error',
  sessionStore: 'file',
  sessionDir: '/tmp/wacore-calls-test',
  webhookEvents: [],
  webhookRetryCount: 0,
  webhookRetryDelay: 0,
  connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000,
  sseHeartbeatMs: 30000,
  autoTyping: false, typingDurationMs: 3000, autoRead: false,
  nodeEnv: 'test',
  mediaDir: '/tmp/media',
  mediaAutoDownload: false,
  mediaBaseUrl: 'http://localhost:19982',
};

const logger = createLogger(testConfig);

function createMockSessionStore(): SessionStore {
  let data: { creds: unknown; keys: unknown } | null = null;
  return {
    save: mock(async (creds: unknown, keys: unknown) => { data = { creds, keys }; }),
    load: mock(async () => data),
    delete: mock(async () => { data = null; }),
    exists: mock(async () => data !== null),
    backup: mock(async () => {}),
  };
}

let manejadores: Map<string, Array<(...args: any[]) => void>>;
let rejectCall: ReturnType<typeof mock>;

function simular(evento: string, ...args: any[]): void {
  for (const h of manejadores?.get(evento) ?? []) h(...args);
}

function crearFabricaSocket() {
  manejadores = new Map();
  rejectCall = mock(async () => {});
  return () => ({
    ev: {
      on(evento: string, handler: (...args: any[]) => void) {
        const lista = manejadores.get(evento) ?? [];
        lista.push(handler);
        manejadores.set(evento, lista);
      },
    },
    user: null as { id: string } | null,
    sendMessage: mock(async () => ({ key: { id: 'x' } })),
    rejectCall,
    signalRepository: { lidMapping: { getPNForLID: async (lid: string) => LID_A_TELEFONO[lid] ?? null } },
    ws: { close: mock(() => {}) },
    logout: mock(async () => {}),
  });
}

/** Traducciones que el repositorio de señal conoce, para las pruebas de acuse. */
const LID_A_TELEFONO: Record<string, string> = {
  '211617400811648@lid': '5358468397@s.whatsapp.net',
};

mock.module('baileys', () => ({
  makeWASocket: crearFabricaSocket(),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0], isLatest: true }),
  DisconnectReason: {},
  useMultiFileAuthState: async () => ({ state: {}, saveCreds: async () => {} }),
  isLidUser: (jid?: string) => !!jid?.endsWith('@lid'),
  jidNormalizedUser: (jid: string) => jid,
}));

async function clienteListo(config: EnvConfig = testConfig) {
  manejadores = new Map();
  rejectCall = mock(async () => {});
  const { createBaileysClient } = await import('../baileys/client');
  const { createAuthProvider } = await import('../baileys/auth');
  const bus = createEventBus();
  const store = createMockSessionStore();
  const authProvider = await createAuthProvider(store, logger);
  const client = await createBaileysClient(config, bus, authProvider, store, logger);
  await client.start();
  return { bus, client };
}

const llamada = (over: Record<string, any> = {}) => ({
  id: 'CALL-1',
  from: '34600111222@s.whatsapp.net',
  chatId: '34600111222@s.whatsapp.net',
  status: 'offer',
  date: new Date(1_800_000_000_000),
  isVideo: false,
  isGroup: false,
  offline: false,
  ...over,
});

describe('acuse de entrega', () => {
  afterEach(() => { manejadores = new Map(); });

  const acuse = (remoteJid: string) => ([{
    key: { remoteJid, id: 'MSG-1', fromMe: true },
    update: { status: 3 },
  }]);

  it('traduce el identificador opaco al teléfono con el que se guardó el mensaje', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('message.status', visto);

    // WhatsApp manda el acuse con `@lid`; el mensaje está guardado bajo el teléfono. Sin
    // traducirlo, el consumidor no puede emparejarlos y el doble check se queda en un tick.
    simular('messages.update', acuse('211617400811648@lid'));
    await new Promise(r => setTimeout(r, 30));

    expect(visto).toHaveBeenCalledTimes(1);
    const evt = (visto.mock.calls[0] as any[])[0];
    expect(evt.chatJid).toBe('5358468397@s.whatsapp.net');
    expect(evt.phone).toBe('5358468397');
    await client.stop();
  });

  it('un acuse que ya viene con teléfono se deja como está', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('message.status', visto);

    simular('messages.update', acuse('5358468397@s.whatsapp.net'));
    await new Promise(r => setTimeout(r, 30));

    const evt = (visto.mock.calls[0] as any[])[0];
    expect(evt.chatJid).toBe('5358468397@s.whatsapp.net');
    expect(evt.statusLabel).toBe('delivered');
    await client.stop();
  });

  it('si la traducción no existe, el acuse sale igual con el lid', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('message.status', visto);

    // Perder el acuse entero por no poder traducirlo sería peor: al menos que llegue.
    simular('messages.update', acuse('999999999@lid'));
    await new Promise(r => setTimeout(r, 30));

    expect(visto).toHaveBeenCalledTimes(1);
    expect((visto.mock.calls[0] as any[])[0].chatJid).toBe('999999999@lid');
    await client.stop();
  });
});

describe('llamadas entrantes', () => {
  afterEach(() => { manejadores = new Map(); });

  it('una llamada sale por el bus con su chat y su hora', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('call', visto);

    simular('call', [llamada()]);

    expect(visto).toHaveBeenCalledTimes(1);
    const evt = (visto.mock.calls[0] as any[])[0];
    expect(evt.id).toBe('CALL-1');
    expect(evt.chatId).toBe('34600111222@s.whatsapp.net');
    expect(evt.status).toBe('offer');
    // En segundos, como el resto de eventos: mezclar unidades es un bug garantizado.
    expect(evt.timestamp).toBe(1_800_000_000);
    await client.stop();
  });

  it('distingue vídeo y grupo', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('call', visto);

    simular('call', [llamada({ isVideo: true, isGroup: true })]);

    const evt = (visto.mock.calls[0] as any[])[0];
    expect(evt.isVideo).toBe(true);
    expect(evt.isGroup).toBe(true);
    await client.stop();
  });

  it('los estados posteriores salen con el MISMO id', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('call', visto);

    simular('call', [llamada({ status: 'offer' })]);
    simular('call', [llamada({ status: 'timeout' })]);

    const ids = (visto.mock.calls as any[]).map(c => c[0].id);
    expect(ids).toEqual(['CALL-1', 'CALL-1']);
    expect((visto.mock.calls as any[]).map(c => c[0].status)).toEqual(['offer', 'timeout']);
    await client.stop();
  });

  it('varias llamadas en un mismo evento salen todas', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('call', visto);

    simular('call', [llamada({ id: 'A' }), llamada({ id: 'B' })]);

    expect(visto).toHaveBeenCalledTimes(2);
    await client.stop();
  });

  it('lo que llega sin id o sin origen se descarta', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('call', visto);

    simular('call', [{ status: 'offer' }, llamada({ from: undefined })]);

    expect(visto).not.toHaveBeenCalled();
    await client.stop();
  });

  it('con la bandera apagada NO se cuelga, pero el registro sale igual', async () => {
    const { bus, client } = await clienteListo();
    const visto = mock();
    bus.on('call', visto);

    simular('call', [llamada()]);

    expect(rejectCall).not.toHaveBeenCalled();
    expect(visto).toHaveBeenCalledTimes(1);
    expect((visto.mock.calls[0] as any[])[0].autoRejected).toBeUndefined();
    await client.stop();
  });

  it('con la bandera encendida cuelga y lo dice en el evento', async () => {
    const { bus, client } = await clienteListo({ ...testConfig, autoRejectCalls: true });
    const visto = mock();
    bus.on('call', visto);

    simular('call', [llamada()]);

    expect(rejectCall).toHaveBeenCalledTimes(1);
    expect((rejectCall.mock.calls[0] as any[])).toEqual(['CALL-1', '34600111222@s.whatsapp.net']);
    expect((visto.mock.calls[0] as any[])[0].autoRejected).toBe(true);
    await client.stop();
  });

  it('solo cuelga la oferta, no los estados siguientes', async () => {
    const { bus, client } = await clienteListo({ ...testConfig, autoRejectCalls: true });
    bus.on('call', mock());

    simular('call', [llamada({ status: 'terminate' })]);

    // Colgar un `terminate` no tiene sentido: la llamada ya acabó.
    expect(rejectCall).not.toHaveBeenCalled();
    await client.stop();
  });

  it('si colgar falla, el registro se publica igualmente', async () => {
    const { bus, client } = await clienteListo({ ...testConfig, autoRejectCalls: true });
    rejectCall.mockImplementationOnce(async () => { throw new Error('nope'); });
    const visto = mock();
    bus.on('call', visto);

    simular('call', [llamada()]);

    // Perder el rastro de la llamada porque no se pudo colgar sería el peor resultado.
    expect(visto).toHaveBeenCalledTimes(1);
    await client.stop();
  });
});
