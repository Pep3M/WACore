import type { Logger } from '../utils/logger';
import type { BaileysClient } from '../baileys/client';

/**
 * Un producto tal y como lo cuenta WhatsApp.
 *
 * `price` va **en la unidad de la moneda**, no en milésimas: la conversión se hace aquí para que
 * el consumidor no tenga que saber en qué escala habla el protocolo. Ver {@link MILESIMAS_POR_UNIDAD}.
 */
export interface CatalogProduct {
  id: string;
  retailerId: string | null;
  name: string;
  description: string | null;
  url: string | null;
  price: number | null;
  currency: string | null;
  isHidden: boolean;
  imageUrls: Record<string, string>;
  reviewStatus: Record<string, string>;
  availability: string;
}

export interface CatalogPage {
  products: CatalogProduct[];
  nextCursor: string | null;
}

export interface ProductInput {
  name: string;
  description: string;
  price: number;
  currency: string;
  retailerId?: string;
  url?: string;
  isHidden?: boolean;
  images: string[];
  originCountryCode?: string;
}

export interface OrderLine {
  id: string | null;
  name: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string | null;
  quantity: number | null;
}

export interface OrderDetail {
  total: number | null;
  currency: string | null;
  products: OrderLine[];
}

export interface CatalogManager {
  list(opts?: { limit?: number; cursor?: string; jid?: string }): Promise<CatalogPage>;
  collections(limit?: number): Promise<Array<{ id: string; name: string; productIds: string[] }>>;
  create(input: ProductInput): Promise<CatalogProduct>;
  update(productId: string, input: ProductInput): Promise<CatalogProduct>;
  remove(productIds: string[]): Promise<number>;
  order(orderId: string, token: string): Promise<OrderDetail>;
}

/**
 * Los importes del catálogo viajan **multiplicados por mil**.
 *
 * Baileys no lo dice ni lo convierte: manda `product.price.toString()` en crudo y lo lee igual,
 * así que un ida y vuelta devuelve lo que se envió sea cual sea la escala y no sirve para
 * deducirla. La evidencia está en el protocolo: **todos** los campos de dinero se llaman
 * `*Amount1000` —`totalAmount1000`, `priceAmount1000`, `salePriceAmount1000`,
 * `paymentAmount1000`— y ese sufijo es la unidad.
 *
 * La conversión vive aquí, en un solo sitio y en los dos sentidos, porque un error de factor mil
 * en un catálogo público no es un fallo de pantalla: es un producto de 30 € a la venta por 3
 * céntimos.
 */
const MILESIMAS_POR_UNIDAD = 1000;

/**
 * WhatsApp no ha contestado a una consulta de comercio.
 *
 * No es una avería nuestra ni un rechazo: la petición sale y se queda esperando. Merece un tipo
 * propio porque el tratamiento es distinto del de un rechazo —no se reintenta, y lo que hay que
 * revisar es la cuenta, no el producto— y porque de otro modo llega al consumidor como un error
 * ininteligible; ver {@link esRespuestaAusente}.
 */
export class CatalogoSinRespuesta extends Error {
  constructor(accion: string) {
    super(
      `WhatsApp no ha respondido a la consulta de catálogo (${accion}). ` +
      'La sesión está viva y responde a otras consultas, así que no es un problema de conexión: ' +
      'suele significar que la cuenta no tiene el comercio habilitado desde este país, ' +
      'o que no es una cuenta de WhatsApp Business con catálogo propio.'
    );
    this.name = 'CatalogoSinRespuesta';
  }
}

/**
 * ¿Este error es en realidad «WhatsApp no contestó»?
 *
 * Hay que deducirlo, y conviene saber por qué. Baileys **se traga** el tiempo agotado de una
 * consulta y devuelve `undefined` en lugar de lanzar (`Socket/socket.js`, «Catch timeout and
 * return undefined instead of throwing»). Ese `undefined` sigue camino hasta el analizador del
 * nodo binario, que revienta leyendo una propiedad de la nada. Lo que llegaba al consumidor tras
 * sesenta segundos era, literalmente:
 *
 *     Cannot read properties of undefined (reading 'attrs')
 *
 * Nadie puede sacar nada de eso. Aquí se traduce a lo que de verdad ha pasado.
 */
function esRespuestaAusente(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;

  // Las dos formas que usa V8 según la versión: «Cannot read properties of undefined (reading
  // 'attrs')» y «Cannot read property 'attrs' of undefined». Se piden las dos piezas por
  // separado para no depender del orden.
  return /Cannot read propert(?:y|ies)/i.test(err.message) && /undefined/i.test(err.message);
}

/**
 * Cuánto se espera a WhatsApp antes de dar la consulta por muerta.
 *
 * **Por debajo de los 60 s de Baileys a propósito** (`defaultQueryTimeoutMs`), y ese margen es lo
 * único que separa «no me han contestado» de «tu catálogo está vacío».
 *
 * El motivo: cuando la consulta se agota, Baileys devuelve `undefined`, y su analizador de nodos
 * binarios es **tolerante con el nodo nulo** —`getBinaryNodeChildren(undefined, …)` devuelve `[]`
 * sin quejarse—. Así que `getCatalog` no revienta: devuelve `{ products: [] }`. Una lista vacía,
 * indistinguible de un catálogo que de verdad no tiene nada.
 *
 * Eso es peor que un error. Un error se ve; un catálogo vacío se cree. Ocurrió: el diagnóstico
 * daba «✔ Se puede leer el catálogo · productos publicados: 0» sobre una línea cuyo teléfono
 * enseñaba cuatro artículos.
 *
 * Adelantándonos cinco segundos, la respuesta falsa no llega a existir. Y no se le quita tiempo a
 * ninguna consulta legítima: el catálogo contesta en menos de un segundo cuando contesta.
 */
const SIN_RESPUESTA_MS = 55_000;

/**
 * Envuelve una operación de catálogo para que un silencio de WhatsApp se lea como tal.
 *
 * El silencio se manifiesta de **dos formas distintas** según qué se estuviera pidiendo, y hacen
 * falta las dos guardas:
 *
 * - **Publicar, actualizar, pedidos**: el analizador revienta con un `TypeError` — lo caza
 *   {@link esRespuestaAusente}.
 * - **Leer el catálogo y las colecciones**: no revienta nada y vuelve una lista vacía — lo caza
 *   la carrera contra {@link SIN_RESPUESTA_MS}.
 */
async function conRespuestaDeWhatsApp<T>(accion: string, fn: () => Promise<T>, espera: number): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;

  const seAgota = new Promise<never>((_, reject) => {
    temporizador = setTimeout(() => reject(new CatalogoSinRespuesta(accion)), espera);
  });

  try {
    return await Promise.race([fn(), seAgota]);
  } catch (err) {
    if (esRespuestaAusente(err)) throw new CatalogoSinRespuesta(accion);
    throw err;
  } finally {
    // Sin esto el proceso se queda con un temporizador vivo por cada consulta que sí contestó.
    if (temporizador) clearTimeout(temporizador);
  }
}

function aMilesimas(precio: number): number {
  return Math.round(precio * MILESIMAS_POR_UNIDAD);
}

function aUnidades(bruto: unknown): number | null {
  const n = typeof bruto === 'number' ? bruto : Number(bruto);
  return Number.isFinite(n) ? n / MILESIMAS_POR_UNIDAD : null;
}

function textoONulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

function mapProduct(p: any): CatalogProduct {
  return {
    id: String(p?.id ?? ''),
    retailerId: textoONulo(p?.retailerId),
    name: String(p?.name ?? ''),
    description: textoONulo(p?.description),
    url: textoONulo(p?.url),
    price: aUnidades(p?.price),
    currency: textoONulo(p?.currency),
    isHidden: p?.isHidden === true,
    imageUrls: (p?.imageUrls ?? {}) as Record<string, string>,
    reviewStatus: (p?.reviewStatus ?? {}) as Record<string, string>,
    availability: String(p?.availability ?? 'in stock'),
  };
}

/**
 * El catálogo de WhatsApp Business de esta línea.
 *
 * Dos cosas que conviene saber antes de tocarlo:
 *
 * - **La línea tiene que ser una cuenta Business.** Una cuenta personal no tiene catálogo y
 *   WhatsApp responde con un error genérico, no con «no tienes catálogo».
 * - **Las imágenes las descarga Meta cuando quiere**, no en el momento de publicar, y vuelve a
 *   descargarlas después. Una URL firmada que caduque en cinco minutos produce un producto sin
 *   imagen días más tarde, sin ningún aviso.
 */
export function createCatalogManager(
  client: BaileysClient,
  logger: Logger,
  opts: { sinRespuestaMs?: number } = {},
): CatalogManager {
  // Inyectable solo para poder probarlo: nadie lo cambia en producción, y esperar 55 segundos
  // en una prueba sería tanto como no tenerla.
  const espera = opts.sinRespuestaMs ?? SIN_RESPUESTA_MS;

  function requireSocket() {
    if (!client.socket) throw new Error('WhatsApp socket not connected');
    return client.socket as any;
  }

  function toBaileys(input: ProductInput) {
    return {
      name: input.name,
      description: input.description,
      price: aMilesimas(input.price),
      currency: input.currency,
      retailerId: input.retailerId,
      url: input.url,
      isHidden: input.isHidden,
      images: input.images.map((url) => ({ url })),
    };
  }

  return {
    async list(consulta = {}): Promise<CatalogPage> {
      const sock = requireSocket();
      const res = await conRespuestaDeWhatsApp<any>('listar',
        () => sock.getCatalog({ jid: consulta.jid, limit: consulta.limit ?? 100, cursor: consulta.cursor }), espera);

      return {
        products: (res?.products ?? []).map(mapProduct),
        nextCursor: textoONulo(res?.nextPageCursor),
      };
    },

    async collections(limit = 50) {
      const sock = requireSocket();
      const res = await conRespuestaDeWhatsApp<any>('colecciones', () => sock.getCollections(undefined, limit), espera);

      return (res?.collections ?? []).map((c: any) => ({
        id: String(c?.id ?? ''),
        name: String(c?.name ?? ''),
        // Solo los ids: una colección puede traer cientos de productos repetidos de la lista
        // principal, y devolverlos enteros multiplicaría el tamaño de la respuesta sin añadir
        // nada que no se pueda sacar de `list()`.
        productIds: (c?.products ?? []).map((p: any) => String(p?.id ?? '')),
      }));
    },

    async create(input: ProductInput): Promise<CatalogProduct> {
      const sock = requireSocket();
      const creado = await conRespuestaDeWhatsApp<any>('publicar', () => sock.productCreate({
        ...toBaileys(input),
        // `undefined` no es lo mismo que ausente: Baileys lo traduce a la exención de país de
        // origen, que es lo que corresponde a un catálogo que no declara procedencia.
        originCountryCode: input.originCountryCode,
      }), espera);

      logger.info('Catalog product created', { id: creado?.id, retailerId: input.retailerId });

      return mapProduct(creado);
    },

    async update(productId: string, input: ProductInput): Promise<CatalogProduct> {
      const sock = requireSocket();
      // `productUpdate` no admite `originCountryCode`: WhatsApp no deja cambiar la procedencia
      // de un producto ya publicado.
      const actualizado = await conRespuestaDeWhatsApp<any>('actualizar',
        () => sock.productUpdate(productId, toBaileys(input)), espera);

      logger.info('Catalog product updated', { id: productId, retailerId: input.retailerId });

      return mapProduct(actualizado);
    },

    async remove(productIds: string[]): Promise<number> {
      const sock = requireSocket();
      const res = await conRespuestaDeWhatsApp<any>('retirar', () => sock.productDelete(productIds), espera);

      logger.info('Catalog products deleted', { asked: productIds.length, deleted: res?.deleted ?? 0 });

      return Number(res?.deleted ?? 0);
    },

    /**
     * Las líneas de un pedido.
     *
     * El `token` viene en el propio mensaje del pedido y **caduca**: quien llame tiene que
     * haberlo guardado al recibirlo, no reconstruirlo después.
     */
    async order(orderId: string, token: string): Promise<OrderDetail> {
      const sock = requireSocket();
      const detalle = await conRespuestaDeWhatsApp<any>('pedido', () => sock.getOrderDetails(orderId, token), espera);

      return {
        total: aUnidades(detalle?.price?.total),
        currency: textoONulo(detalle?.price?.currency),
        products: (detalle?.products ?? []).map((p: any) => ({
          id: textoONulo(p?.id),
          name: textoONulo(p?.name),
          imageUrl: textoONulo(p?.imageUrl),
          price: aUnidades(p?.price),
          currency: textoONulo(p?.currency),
          quantity: typeof p?.quantity === 'number' ? p.quantity : null,
        })),
      };
    },
  };
}
