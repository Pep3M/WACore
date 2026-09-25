import { describe, expect, it } from 'bun:test';
import { normalizeMessage } from '../core/normalize-message';

/**
 * Pedidos, fichas de producto y citas entrantes.
 *
 * Lo que más se vigila aquí es la **escala del dinero**. WhatsApp manda todos los importes
 * multiplicados por mil —el propio nombre de los campos lo dice: `totalAmount1000`,
 * `priceAmount1000`— y dejarlos pasar en crudo significa que el consumidor apunte un pedido de 45 € como
 * uno de 45.000 €. No hay pantalla en la que eso se vea como un error de unidades: se ve como un
 * pedido enorme.
 */

function sobre(message: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    key: { id: 'MSG1', remoteJid: '34600111222@s.whatsapp.net', fromMe: false },
    messageTimestamp: 1_700_000_000,
    pushName: 'Cliente',
    message,
    ...extra,
  };
}

describe('pedidos del catálogo', () => {
  it('el total llega en euros, no en milésimas', () => {
    const n = normalizeMessage(sobre({
      orderMessage: {
        orderId: 'ORD-1',
        token: 'tok-abc',
        itemCount: 3,
        totalAmount1000: 45_000,
        totalCurrencyCode: 'EUR',
        orderTitle: 'Pedido',
      },
    }));

    expect(n?.type).toBe('order');
    expect(n?.extras?.total).toBe(45);
    expect(n?.extras?.currency).toBe('EUR');
    expect(n?.extras?.itemCount).toBe(3);
  });

  /**
   * `orderId` y `token` son la única forma de pedirle a WhatsApp las líneas del pedido, y el
   * token **caduca**. Si no viajaran en el evento, el detalle del pedido sería irrecuperable.
   */
  it('lleva el identificador y el token, que son perecederos', () => {
    const n = normalizeMessage(sobre({
      orderMessage: { orderId: 'ORD-1', token: 'tok-abc', totalAmount1000: 1000, totalCurrencyCode: 'EUR' },
    }));

    expect(n?.extras?.orderId).toBe('ORD-1');
    expect(n?.extras?.token).toBe('tok-abc');
  });

  it('el cuerpo se puede leer en el chat, no sale una burbuja vacía', () => {
    const n = normalizeMessage(sobre({
      orderMessage: { orderId: 'ORD-1', itemCount: 2, totalAmount1000: 30_000, totalCurrencyCode: 'EUR' },
    }));

    expect(n?.body).toContain('2 artículo');
    expect(n?.body).toContain('30 EUR');
  });

  /** Los importes grandes llegan como Long de protobuf, no como number. */
  it('aguanta un importe que venga como Long', () => {
    const n = normalizeMessage(sobre({
      orderMessage: { orderId: 'O', totalAmount1000: { toNumber: () => 120_500 }, totalCurrencyCode: 'EUR' },
    }));

    expect(n?.extras?.total).toBe(120.5);
  });
});

describe('ficha de producto que toca el cliente', () => {
  it('trae el retailerId, que es lo que permite contestar sobre ese producto', () => {
    const n = normalizeMessage(sobre({
      productMessage: {
        businessOwnerJid: '34600999888@s.whatsapp.net',
        product: {
          productId: 'PROD-1',
          retailerId: 'SKU-42',
          title: 'Silla',
          priceAmount1000: 19_990,
          currencyCode: 'EUR',
        },
      },
    }));

    expect(n?.type).toBe('product');
    expect(n?.extras?.retailerId).toBe('SKU-42');
    expect(n?.extras?.price).toBe(19.99);
    expect(n?.body).toBe('Silla');
  });
});

describe('citas de calendario', () => {
  /**
   * La trampa del nombre. En el protocolo el campo es `isCanceled` **con una ele**, aunque las
   * opciones de envío de Baileys lo llamen `isCancelled`. Leer el de envío devuelve `undefined`
   * y una cita cancelada pasaría por vigente — el cliente se presentaría a una visita anulada.
   */
  it('lee la cancelación del campo con una sola ele', () => {
    const n = normalizeMessage(sobre({
      eventMessage: { name: 'Visita', startTime: 1_700_000_000, isCanceled: true },
    }));

    expect(n?.type).toBe('event');
    expect(n?.extras?.isCancelled).toBe(true);
  });

  it('una cita vigente no se marca como cancelada', () => {
    const n = normalizeMessage(sobre({
      eventMessage: { name: 'Visita', startTime: 1_700_000_000 },
    }));

    expect(n?.extras?.isCancelled).toBe(false);
  });

  it('la ubicación viaja con sus coordenadas', () => {
    const n = normalizeMessage(sobre({
      eventMessage: {
        name: 'Visita',
        startTime: 1_700_000_000,
        endTime: 1_700_003_600,
        location: { degreesLatitude: 40.4, degreesLongitude: -3.7, name: 'Oficina' },
      },
    }));

    expect(n?.extras?.location).toEqual({
      latitude: 40.4,
      longitude: -3.7,
      name: 'Oficina',
      address: null,
    });
    expect(n?.extras?.endTime).toBe(1_700_003_600);
  });
});
