import { describe, expect, it, mock } from 'bun:test';
import { createMessageSender } from '../services/message-sender';
import { createEventBus } from '../core/event-bus';
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

function crearSender() {
  const enviados: Array<{ jid: string; content: any }> = [];
  const sendMessage = mock(async (jid: string, content: any) => {
    enviados.push({ jid, content });
    return { key: { id: 'MSG1', remoteJid: jid, fromMe: true }, message: {} };
  });
  const client = { sendMessage } as unknown as BaileysClient;
  const sender = createMessageSender(client, createEventBus(), logger);
  return { sender, enviados };
}

describe('enviar una cita como evento nativo', () => {
  it('traduce segundos Unix a la fecha que espera Baileys', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendEvent('34600111222', { name: 'Visita', startTime: 1_700_000_000 });

    const ev = enviados[0]!.content.event;
    expect(ev.startDate).toBeInstanceOf(Date);
    expect(Math.floor(ev.startDate.getTime() / 1000)).toBe(1_700_000_000);
  });

  it('el número suelto se convierte en JID', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendEvent('34600111222', { name: 'Visita', startTime: 1 });

    expect(enviados[0]!.jid).toBe('34600111222@s.whatsapp.net');
  });

  /**
   * Cancelar una cita es volver a mandarla marcada. No hay edición: el contenido `event` de
   * Baileys no admite `edit`, al revés que un texto o una encuesta.
   */
  it('la cancelación viaja en la tarjeta', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendEvent('34600111222', { name: 'Visita', startTime: 1, isCancelled: true });

    expect(enviados[0]!.content.event.isCancelled).toBe(true);
  });

  it('una cita normal no sale marcada como cancelada', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendEvent('34600111222', { name: 'Visita', startTime: 1 });

    expect(enviados[0]!.content.event.isCancelled).toBe(false);
  });

  it('la ubicación se traduce a los nombres del protocolo', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendEvent('34600111222', {
      name: 'Visita',
      startTime: 1,
      location: { latitude: 40.4, longitude: -3.7, name: 'Oficina', address: 'Gran Vía 1' },
    });

    expect(enviados[0]!.content.event.location).toEqual({
      degreesLatitude: 40.4,
      degreesLongitude: -3.7,
      name: 'Oficina',
      address: 'Gran Vía 1',
    });
  });

  it('sin fin, no se manda un fin vacío', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendEvent('34600111222', { name: 'Visita', startTime: 1 });

    expect(enviados[0]!.content.event.endDate).toBeUndefined();
  });
});

describe('enviar una ficha de producto', () => {
  it('el precio va en milésimas, que es como se llama el campo', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendProduct('34600111222', {
      productId: 'P1', title: 'Silla', price: 30, currency: 'EUR', imageUrl: 'http://x/1.jpg',
    });

    expect(enviados[0]!.content.product.priceAmount1000).toBe(30_000);
  });

  it('el precio rebajado solo viaja si existe', async () => {
    const { sender, enviados } = crearSender();

    await sender.sendProduct('34600111222', {
      productId: 'P1', title: 'Silla', price: 30, currency: 'EUR', imageUrl: 'http://x/1.jpg',
    });
    await sender.sendProduct('34600111222', {
      productId: 'P2', title: 'Mesa', price: 30, salePrice: 24.5, currency: 'EUR', imageUrl: 'http://x/2.jpg',
    });

    expect(enviados[0]!.content.product.salePriceAmount1000).toBeUndefined();
    expect(enviados[1]!.content.product.salePriceAmount1000).toBe(24_500);
  });
});
