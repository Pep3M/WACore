import { describe, expect, it, mock } from 'bun:test';
import { createCatalogManager } from '../services/catalog-manager';
import { createLogger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';

const logger = createLogger({
  instanceName: 'test', healthPort: 1, apiPort: 2, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false, qrTimeout: 1000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1, messageBufferTtlMs: 1,
  sseHeartbeatMs: 1, nodeEnv: 'test', autoTyping: false, typingDurationMs: 1, autoRead: false,
  apiKey: 'k', mediaDir: '/tmp', mediaAutoDownload: false, mediaBaseUrl: 'http://x',
} as any);

function conSocket(socket: any): BaileysClient {
  return { socket } as unknown as BaileysClient;
}

/**
 * El catálogo de WhatsApp Business.
 *
 * Todo lo que se prueba aquí gira alrededor de una sola cosa: **la escala del precio**. Baileys
 * manda el número tal cual y lo lee tal cual, así que un ida y vuelta devuelve lo que se envió
 * sea cual sea la escala y no delata un error. El único sitio donde se puede vigilar es este.
 */
describe('CatalogManager — la escala del precio', () => {
  it('publica en milésimas lo que recibe en euros', async () => {
    const productCreate = mock(async (p: any) => ({ id: 'P1', ...p }));
    const mgr = createCatalogManager(conSocket({ productCreate }), logger);

    await mgr.create({
      name: 'Silla', description: 'Cómoda', price: 30, currency: 'EUR', images: ['http://x/1.jpg'],
    });

    expect(productCreate.mock.calls[0]![0].price).toBe(30_000);
  });

  it('redondea sin dejar decimales sueltos', async () => {
    const productCreate = mock(async (p: any) => ({ id: 'P1', ...p }));
    const mgr = createCatalogManager(conSocket({ productCreate }), logger);

    await mgr.create({
      name: 'Mesa', description: 'x', price: 19.99, currency: 'EUR', images: ['http://x/1.jpg'],
    });

    expect(productCreate.mock.calls[0]![0].price).toBe(19_990);
  });

  it('devuelve en euros lo que WhatsApp cuenta en milésimas', async () => {
    const getCatalog = mock(async () => ({
      products: [{ id: 'P1', name: 'Silla', price: 30_000, currency: 'EUR', retailerId: 'SKU-1' }],
      nextPageCursor: 'siguiente',
    }));
    const mgr = createCatalogManager(conSocket({ getCatalog }), logger);

    const page = await mgr.list();

    expect(page.products[0]!.price).toBe(30);
    expect(page.products[0]!.retailerId).toBe('SKU-1');
    expect(page.nextCursor).toBe('siguiente');
  });

  it('la conversión es simétrica: lo que se publica es lo que se lee', async () => {
    const guardado: any[] = [];
    const productCreate = mock(async (p: any) => { guardado.push(p); return { id: 'P1', ...p }; });
    const mgr = createCatalogManager(conSocket({ productCreate }), logger);

    const creado = await mgr.create({
      name: 'Silla', description: 'x', price: 45.5, currency: 'EUR', images: ['http://x/1.jpg'],
    });

    expect(guardado[0].price).toBe(45_500);
    expect(creado.price).toBe(45.5);
  });
});

describe('CatalogManager — pedidos', () => {
  it('el total y las líneas llegan en euros', async () => {
    const getOrderDetails = mock(async () => ({
      price: { total: 45_000, currency: 'EUR' },
      products: [{ id: 'P1', name: 'Silla', price: 22_500, currency: 'EUR', quantity: 2, imageUrl: 'http://x/1.jpg' }],
    }));
    const mgr = createCatalogManager(conSocket({ getOrderDetails }), logger);

    const order = await mgr.order('ORD-1', 'tok');

    expect(order.total).toBe(45);
    expect(order.products[0]!.price).toBe(22.5);
    expect(order.products[0]!.quantity).toBe(2);
  });
});

describe('CatalogManager — la línea caída', () => {
  /**
   * Sin socket no hay catálogo. El mensaje importa: quien llama lo usa para distinguir «la línea
   * está caída», que se reintenta, de «WhatsApp ha dicho que no», que no.
   */
  it('sin socket avisa de que no hay conexión, no de un fallo cualquiera', async () => {
    const mgr = createCatalogManager(conSocket(null), logger);

    await expect(mgr.list()).rejects.toThrow('WhatsApp socket not connected');
    await expect(mgr.order('O', 't')).rejects.toThrow('WhatsApp socket not connected');
  });
});

describe('CatalogManager — borrar', () => {
  it('borrar lo que ya no está devuelve cero, no un error', async () => {
    const productDelete = mock(async () => ({ deleted: 0 }));
    const mgr = createCatalogManager(conSocket({ productDelete }), logger);

    expect(await mgr.remove(['P1'])).toBe(0);
  });
});

/**
 * El silencio de WhatsApp.
 *
 * Baileys **se traga** el tiempo agotado de una consulta y devuelve `undefined` en lugar de
 * lanzar, así que el fallo aparece sesenta segundos después y disfrazado: un `TypeError` del
 * analizador del nodo binario leyendo una propiedad de la nada. Lo que llegaba al consumidor era
 * `Cannot read properties of undefined (reading 'attrs')`, y con eso no se puede hacer nada.
 *
 * Pasó de verdad: en una línea conectada, con las demás consultas respondiendo en centésimas de
 * segundo, ni leer ni publicar el catálogo obtuvieron respuesta jamás.
 */
describe('CatalogManager — cuando WhatsApp no contesta', () => {
  const sinRespuesta = () => new TypeError("Cannot read properties of undefined (reading 'attrs')");

  it('traduce el fallo del analizador a un motivo que se entiende', async () => {
    const getCatalog = mock(async () => { throw sinRespuesta(); });
    const mgr = createCatalogManager(conSocket({ getCatalog }), logger);

    await expect(mgr.list()).rejects.toThrow(/no ha respondido a la consulta de catálogo/i);
  });

  it('lo distingue también al publicar, que es donde más caro sale', async () => {
    const productCreate = mock(async () => { throw sinRespuesta(); });
    const mgr = createCatalogManager(conSocket({ productCreate }), logger);

    const fallo = mgr.create({
      name: 'Silla', description: 'x', price: 30, currency: 'EUR', images: ['http://x/1.jpg'],
    });

    await expect(fallo).rejects.toThrow(/publicar/);
    await expect(fallo).rejects.toHaveProperty('name', 'CatalogoSinRespuesta');
  });

  // Un rechazo de WhatsApp —una imagen inservible, un SKU repetido— no es lo mismo y no debe
  // acabar contando que nadie contestó: se arregla mirando el producto, no la cuenta.
  it('deja pasar tal cual los errores que sí tienen explicación', async () => {
    const productCreate = mock(async () => { throw new Error('image download failed'); });
    const mgr = createCatalogManager(conSocket({ productCreate }), logger);

    await expect(mgr.create({
      name: 'Silla', description: 'x', price: 30, currency: 'EUR', images: ['http://x/1.jpg'],
    })).rejects.toThrow('image download failed');
  });
});

/**
 * El silencio **que no revienta**, que es el peligroso.
 *
 * Al leer, una consulta agotada no lanza nada: Baileys devuelve `undefined` y su analizador de
 * nodos binarios es tolerante con el nodo nulo, así que `getCatalog` devuelve `{ products: [] }`.
 * Una lista vacía indistinguible de un catálogo que de verdad está vacío.
 *
 * Pasó tal cual: el diagnóstico dio «✔ Se puede leer el catálogo · productos publicados: 0» sobre
 * una línea cuyo teléfono enseñaba cuatro artículos. Un error se ve; un catálogo vacío se cree.
 */
describe('CatalogManager — la lectura que vuelve vacía sin haber contestado', () => {
  it('no llama catálogo vacío a una consulta que nunca respondió', async () => {
    // Como se comporta Baileys al agotarse: tarda, y devuelve la lista vacía sin quejarse.
    const getCatalog = mock(async () => {
      await new Promise((r) => setTimeout(r, 60));

      return { products: [], nextPageCursor: undefined };
    });
    const mgr = createCatalogManager(conSocket({ getCatalog }), logger, { sinRespuestaMs: 20 });

    await expect(mgr.list()).rejects.toThrow(/no ha respondido a la consulta de catálogo/i);
  });

  // La contrapartida: un catálogo de verdad vacío contesta rápido y **sí** es una lista vacía.
  it('un catálogo vacío de verdad sigue siendo una lista vacía', async () => {
    const getCatalog = mock(async () => ({ products: [], nextPageCursor: undefined }));
    const mgr = createCatalogManager(conSocket({ getCatalog }), logger, { sinRespuestaMs: 200 });

    await expect(mgr.list()).resolves.toEqual({ products: [], nextCursor: null });
  });

  it('lo mismo con las colecciones', async () => {
    const getCollections = mock(async () => {
      await new Promise((r) => setTimeout(r, 60));

      return { collections: [] };
    });
    const mgr = createCatalogManager(conSocket({ getCollections }), logger, { sinRespuestaMs: 20 });

    await expect(mgr.collections()).rejects.toThrow(/no ha respondido/i);
  });

  // Una respuesta lenta pero real no se descarta: el tope está para el silencio, no para la prisa.
  it('una respuesta lenta pero real se acepta', async () => {
    const getCatalog = mock(async () => {
      await new Promise((r) => setTimeout(r, 30));

      return { products: [{ id: 'P1', name: 'Silla', price: 30_000 }], nextPageCursor: null };
    });
    const mgr = createCatalogManager(conSocket({ getCatalog }), logger, { sinRespuestaMs: 300 });

    const pagina = await mgr.list();

    expect(pagina.products).toHaveLength(1);
    expect(pagina.products[0]!.price).toBe(30);
  });
});
