import { describe, expect, it, mock, afterAll } from 'bun:test';
import { createRestApi } from '../transport/rest-api';
import { createLogger } from '../utils/logger';
import { createEventBus } from '../core/event-bus';
import type { SessionManager, ManagedSession } from '../sessions/session-manager';
import type { CatalogManager } from '../services/catalog-manager';

const PORT = 19931;

const mockConfig = {
  instanceName: 'test', healthPort: 19932, apiPort: PORT, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false, qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000,
  sseHeartbeatMs: 30000, nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000,
  autoRead: false, apiKey: 'k', mediaDir: '/tmp/media', mediaAutoDownload: false,
  mediaBaseUrl: `http://localhost:${PORT}`,
};
const logger = createLogger(mockConfig as any);
const cabeceras = { Authorization: 'Bearer k', 'Content-Type': 'application/json' };

const catalogManager = {
  list: mock(async () => ({ products: [{ id: 'P1', price: 30 }], nextCursor: null })),
  collections: mock(async () => []),
  create: mock(async () => ({ id: 'P1', price: 30 })),
  update: mock(async () => ({ id: 'P1', price: 30 })),
  remove: mock(async () => 1),
  order: mock(async () => ({ total: 45, currency: 'EUR', products: [] })),
} as unknown as CatalogManager;

const sendEvent = mock(async () => 'EVT1');
const sendProduct = mock(async () => 'PRD1');

function crearSesion(): ManagedSession {
  return {
    sessionId: 'test', accountId: null, userId: null,
    client: {} as any,
    messageSender: { sendEvent, sendProduct } as any,
    presenceManager: {} as any, readReceiptManager: {} as any, groupManager: {} as any,
    profileManager: {} as any, labelManager: {} as any, chatManager: {} as any,
    catalogManager,
    localEventBus: createEventBus(),
    start: async () => {}, stop: async () => {}, logout: async () => {},
    getInfo: () => ({ sessionId: 'test', accountId: null, userId: null, status: 'connected' as any, phoneNumber: null, displayName: null, lastSeenAt: null }),
  };
}

const session = crearSesion();
const sessionManager: SessionManager = {
  bootstrap: async () => {}, get: () => session, getOrLegacy: () => session,
  create: async () => session, destroy: async () => {},
  list: () => [session.getInfo()], stopAll: async () => {},
};

const api = createRestApi(PORT, mockConfig as any, logger, sessionManager);
api.start();
afterAll(() => { api.stop(); });

const post = (ruta: string, body: unknown) =>
  fetch(`http://localhost:${PORT}${ruta}`, { method: 'POST', headers: cabeceras, body: JSON.stringify(body) });

const productoValido = {
  name: 'Silla', description: 'Cómoda', price: 30, currency: 'EUR', images: ['http://x/1.jpg'],
};

describe('POST /api/catalog/products', () => {
  it('publica un producto válido', async () => {
    const res = await post('/api/catalog/products', productoValido);
    expect(res.status).toBe(200);
    expect((await res.json() as any).data.product.id).toBe('P1');
  });

  /**
   * WhatsApp exige una imagen y la rechaza sin decir por qué. Es la primera causa de fallos
   * mudos al publicar, así que se para en la puerta con un motivo legible.
   */
  it('sin imágenes lo rechaza diciendo que WhatsApp las exige', async () => {
    const res = await post('/api/catalog/products', { ...productoValido, images: [] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain('images');
  });

  it('una imagen que no es una URL pública no vale', async () => {
    const res = await post('/api/catalog/products', { ...productoValido, images: ['/local/1.jpg'] });
    expect(res.status).toBe(400);
  });

  it('un precio de cero o negativo no es un producto de catálogo', async () => {
    expect((await post('/api/catalog/products', { ...productoValido, price: 0 })).status).toBe(400);
    expect((await post('/api/catalog/products', { ...productoValido, price: -5 })).status).toBe(400);
  });

  it('la moneda tiene que ser el código de tres letras', async () => {
    const res = await post('/api/catalog/products', { ...productoValido, currency: 'euros' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/catalog', () => {
  it('sin jid lee el catálogo propio', async () => {
    await fetch(`http://localhost:${PORT}/api/catalog`, { headers: cabeceras });

    const opts = (catalogManager.list as any).mock.calls.at(-1)[0];
    expect(opts.jid).toBeUndefined();
  });

  /**
   * Con `jid` se lee el catálogo de **otro** negocio: hace falta para responder sobre un producto
   * que el cliente ha compartido desde otra tienda.
   */
  it('con jid lee el catálogo de otro negocio', async () => {
    await fetch(`http://localhost:${PORT}/api/catalog?jid=34600111222@s.whatsapp.net`, { headers: cabeceras });

    const opts = (catalogManager.list as any).mock.calls.at(-1)[0];
    expect(opts.jid).toBe('34600111222@s.whatsapp.net');
  });
});

describe('POST /api/send-event', () => {
  it('manda la cita y avisa de que no se puede editar', async () => {
    const res = await post('/api/send-event', { to: '34600111222', name: 'Visita', startTime: 1_700_000_000 });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.data.id).toBe('EVT1');
    // El contrato lo dice en la respuesta para que el consumidor no lo tenga que averiguar probando.
    expect(json.data.editable).toBe(false);
  });

  it('un fin anterior al inicio no se acepta', async () => {
    const res = await post('/api/send-event', {
      to: '34600111222', name: 'Visita', startTime: 1_700_000_000, endTime: 1_600_000_000,
    });
    expect(res.status).toBe(400);
  });

  /**
   * Una ubicación sin coordenadas de verdad pinta un marcador roto en el móvil del cliente.
   * Mejor rechazarla que mandar una cita que se ve mal.
   */
  it('una ubicación sin coordenadas se rechaza', async () => {
    const res = await post('/api/send-event', {
      to: '34600111222', name: 'Visita', startTime: 1, location: { name: 'Oficina' },
    });
    expect(res.status).toBe(400);
  });

  it('unas coordenadas fuera de rango se rechazan', async () => {
    const res = await post('/api/send-event', {
      to: '34600111222', name: 'Visita', startTime: 1, location: { latitude: 200, longitude: 0 },
    });
    expect(res.status).toBe(400);
  });

  it('sin nombre no hay cita', async () => {
    const res = await post('/api/send-event', { to: '34600111222', startTime: 1 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/orders/:id', () => {
  it('sin token dice que viene con el mensaje del pedido', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/orders/ORD-1`, { headers: cabeceras });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain('token');
  });

  it('con token devuelve el detalle', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/orders/ORD-1?token=tok`, { headers: cabeceras });
    expect(res.status).toBe(200);
    expect((await res.json() as any).data.order.total).toBe(45);
  });
});

describe('la línea caída se distingue de un fallo', () => {
  /**
   * 503 y no 500 a propósito: quien llama tiene que poder reintentar cuando la línea está caída
   * y **no** reintentar cuando WhatsApp ha rechazado el producto. Con un 500 para todo acabaría
   * reintentando en balde y gastando cuota.
   */
  it('sin socket responde 503', async () => {
    (catalogManager.list as any).mockImplementationOnce(async () => {
      throw new Error('WhatsApp socket not connected');
    });

    const res = await fetch(`http://localhost:${PORT}/api/catalog`, { headers: cabeceras });
    expect(res.status).toBe(503);
  });

  it('un rechazo de WhatsApp responde 500', async () => {
    (catalogManager.list as any).mockImplementationOnce(async () => {
      throw new Error('product rejected by policy');
    });

    const res = await fetch(`http://localhost:${PORT}/api/catalog`, { headers: cabeceras });
    expect(res.status).toBe(500);
  });
});
