import { describe, expect, it, mock, afterAll } from 'bun:test';
import { normalizeMessage } from '../core/normalize-message';
import { buttonsAsText, listAsText } from '../services/interactive-text';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { MessageSender } from '../services/message-sender';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';

const PORT_ON = 19941;
const PORT_OFF = 19943;
const CHAT = '34600111222@s.whatsapp.net';

function conf(port: number, interactivos: boolean) {
  return {
    instanceName: 'test', healthPort: port + 1, apiPort: port, logLevel: 'error' as const,
    sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
    webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
    qrTimeout: 60000,
    pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
    nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, autoRead: false, apiKey: 'k',
    mediaDir: '/tmp/media', mediaAutoDownload: false, mediaBaseUrl: `http://localhost:${port}`,
    interactiveMessages: interactivos,
  };
}
const logger = createLogger(conf(PORT_ON, true));

function crudo(message: any) {
  return { key: { remoteJid: CHAT, id: 'M1', fromMe: false }, messageTimestamp: 1_800_000_000, pushName: 'Ana', message };
}

describe('respuesta interactiva entrante', () => {
  it('un botón pulsado llega como texto con lo que dice el botón', () => {
    const n = normalizeMessage(crudo({
      buttonsResponseMessage: { selectedButtonId: 'opt_si', selectedDisplayText: 'Sí, me interesa' },
    }));
    expect(n?.type).toBe('text');
    expect(n?.body).toBe('Sí, me interesa');
    expect(n?.extras?.selection).toEqual({ kind: 'button', id: 'opt_si', text: 'Sí, me interesa' });
  });

  it('una fila de lista llega con el id de la fila', () => {
    const n = normalizeMessage(crudo({
      listResponseMessage: { title: 'Piso en Chamberí', singleSelectReply: { selectedRowId: 'inm_42' } },
    }));
    expect(n?.body).toBe('Piso en Chamberí');
    expect(n?.extras?.selection).toEqual({ kind: 'list', id: 'inm_42', text: 'Piso en Chamberí' });
  });

  it('el formato de plantilla también se reconoce', () => {
    const n = normalizeMessage(crudo({
      templateButtonReplyMessage: { selectedId: 'tpl_1', selectedDisplayText: 'Llamadme' },
    }));
    expect(n?.body).toBe('Llamadme');
    expect((n?.extras?.selection as any).kind).toBe('template');
  });

  it('el formato nativo nuevo saca el id de su JSON', () => {
    const n = normalizeMessage(crudo({
      interactiveResponseMessage: {
        body: { text: 'Reservar visita' },
        nativeFlowResponseMessage: { name: 'cta', paramsJson: '{"id":"visita_9"}' },
      },
    }));
    expect(n?.body).toBe('Reservar visita');
    expect((n?.extras?.selection as any).id).toBe('visita_9');
  });

  it('un JSON ilegible no tira la respuesta: se queda sin id, pero con el texto', () => {
    const n = normalizeMessage(crudo({
      interactiveResponseMessage: {
        body: { text: 'Reservar visita' },
        nativeFlowResponseMessage: { name: 'cta', paramsJson: '{roto' },
      },
    }));
    expect(n?.body).toBe('Reservar visita');
    expect((n?.extras?.selection as any).id).toBeNull();
  });

  it('un texto normal no lleva selección', () => {
    const n = normalizeMessage(crudo({ conversation: 'hola' }));
    expect(n?.body).toBe('hola');
    expect(n?.extras).toBeUndefined();
  });
});

describe('degradación a texto', () => {
  it('numera los botones y conserva el pie', () => {
    const t = buttonsAsText({
      to: CHAT, body: '¿Te interesa?', footer: 'Inmobiliaria Acme',
      buttons: [{ id: 'a', title: 'Sí' }, { id: 'b', title: 'No' }],
    });
    expect(t).toBe('¿Te interesa?\n\n1. Sí\n2. No\n\nInmobiliaria Acme');
  });

  it('numera la lista de corrido entre secciones', () => {
    const t = listAsText({
      to: CHAT, body: 'Esto tenemos', header: 'Catálogo',
      sections: [
        { title: 'Pisos', rows: [{ id: '1', title: 'Chamberí', description: '2 hab' }] },
        { title: 'Chalets', rows: [{ id: '2', title: 'Pozuelo' }] },
      ],
    });
    // La segunda sección sigue en 2: reiniciar la cuenta daría dos «1».
    expect(t).toContain('1. Chamberí (2 hab)');
    expect(t).toContain('2. Pozuelo');
    expect(t.startsWith('Catálogo')).toBe(true);
  });
});

// ─── Rutas ──────────────────────────────────────────────────

function sesion(messageSender: MessageSender): ManagedSession {
  return {
    sessionId: 'test', accountId: null, userId: null,
    client: {} as any, messageSender,
    presenceManager: {} as any, readReceiptManager: {} as any,
    groupManager: {} as any, profileManager: {} as any, labelManager: {} as any, chatManager: {} as any,
    localEventBus: createEventBus(),
    start: async () => {}, stop: async () => {}, logout: async () => {},
    getInfo: () => ({ sessionId: 'test', accountId: null, userId: null, status: 'connected' as any, phoneNumber: null, displayName: null, lastSeenAt: null }),
  };
}

function sm(messageSender: MessageSender): SessionManager {
  const s = sesion(messageSender);
  return {
    bootstrap: async () => {}, get: () => s, getOrLegacy: () => s, create: async () => s,
    destroy: async () => {}, list: () => [], stopAll: async () => {},
  };
}

const cab = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };

describe('rutas de botones y listas', () => {
  const sendButtons = mock(async () => 'BTN1');
  const sendList = mock(async () => 'LST1');
  const sendText = mock(async () => 'TXT1');
  const sender = {
    sendText, sendMedia: mock(async () => 'x'), sendSticker: mock(async () => 'x'),
    sendLocation: mock(async () => 'x'), sendContact: mock(async () => 'x'),
    sendPtt: mock(async () => 'x'), sendList, sendButtons,
    revoke: mock(async () => {}), edit: mock(async () => 'x'), pin: mock(async () => 'x'),
    react: mock(async () => {}), forward: mock(async () => []),
  } as unknown as MessageSender;

  const api = createRestApi(PORT_ON, conf(PORT_ON, true), logger, sm(sender));
  const apiOff = createRestApi(PORT_OFF, conf(PORT_OFF, false), logger, sm(sender));
  api.start(); apiOff.start();
  afterAll(() => { api.stop(); apiOff.stop(); });

  const post = (puerto: number, ruta: string, body: unknown) =>
    fetch(`http://localhost:${puerto}${ruta}`, { method: 'POST', headers: cab, body: JSON.stringify(body) });

  const botonesOk = { to: CHAT, body: '¿Te interesa?', buttons: [{ id: 'a', title: 'Sí' }] };
  const listaOk = { to: CHAT, body: 'Elige', sections: [{ title: 'S', rows: [{ id: '1', title: 'A' }] }] };

  it('con la bandera apagada responde 501, no 404', async () => {
    const res = await post(PORT_OFF, '/api/send-buttons', botonesOk);
    expect(res.status).toBe(501);
    expect(((await res.json()) as any).error).toContain('WACORE_INTERACTIVE_MESSAGES');
  });

  it('la lista también está tras la bandera', async () => {
    expect((await post(PORT_OFF, '/api/send-list', listaOk)).status).toBe(501);
  });

  it('envía los botones cuando está encendida', async () => {
    const res = await post(PORT_ON, '/api/send-buttons', botonesOk);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.sentAs).toBe('buttons');
  });

  it('rechaza más de tres botones', async () => {
    const res = await post(PORT_ON, '/api/send-buttons', {
      ...botonesOk,
      buttons: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, title: `B${i}` })),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza una lista sin filas', async () => {
    const res = await post(PORT_ON, '/api/send-list', { to: CHAT, body: 'x', sections: [{ title: 'S', rows: [] }] });
    expect(res.status).toBe(400);
  });

  it('si WhatsApp rechaza los botones, sale como texto y lo dice', async () => {
    sendButtons.mockImplementationOnce(async () => { throw new Error('not supported'); });
    const res = await post(PORT_ON, '/api/send-buttons', botonesOk);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.sentAs).toBe('text');
    expect(json.data.fallbackReason).toContain('not supported');
    expect((sendText.mock.calls.at(-1) as any[])[1]).toContain('1. Sí');
  });

  it('con fallbackToText:false el error se propaga', async () => {
    sendButtons.mockImplementationOnce(async () => { throw new Error('not supported'); });
    const res = await post(PORT_ON, '/api/send-buttons', { ...botonesOk, fallbackToText: false });
    expect(res.status).toBe(500);
  });

  it('la lista también degrada a texto', async () => {
    sendList.mockImplementationOnce(async () => { throw new Error('nope'); });
    const res = await post(PORT_ON, '/api/send-list', listaOk);
    expect(((await res.json()) as any).data.sentAs).toBe('text');
  });
});
