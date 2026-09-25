import type { EventBus } from '../core/event-bus';
import type { Logger } from '../utils/logger';
import type { EnvConfig, WebhookPayload, WACoreEventName } from '../types';
import { MESSAGE_EVENT_NAMES } from '../types';
import type { CircuitBreaker } from './circuit-breaker';
import { createCircuitBreaker } from './circuit-breaker';
import { sleep } from '../utils/retry';

export interface WebhookDispatcher {
  start(): void;
  stop(): void;
}

export function createWebhookDispatcher(
  eventBus: EventBus,
  config: EnvConfig,
  logger: Logger,
): WebhookDispatcher {
  if (!config.webhookUrl) {
    return {
      start() { logger.info('Webhook dispatcher disabled (no WEBHOOK_URL)'); },
      stop() {},
    };
  }

  let active = false;
  const allowedEvents = new Set(config.webhookEvents);
  const circuitBreaker: CircuitBreaker = createCircuitBreaker(
    'webhook',
    config.webhookRetryCount,
    config.webhookRetryDelay * 10,
    logger,
  );

  async function sign(body: string): Promise<string> {
    if (!config.webhookSecret) return '';
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(config.webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hex = Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex;
  }

  async function deliver(payload: WebhookPayload): Promise<void> {
    if (!circuitBreaker.isAllowed()) {
      logger.warn('Webhook skipped (circuit open)', { event: payload.event });
      return;
    }

    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-WACore-Event': payload.event,
      'X-WACore-Instance': payload.instanceId,
      'X-WACore-Timestamp': payload.timestamp,
    };

    if (config.webhookSecret) {
      headers['X-WACore-Signature'] = await sign(body);
    }

    for (let attempt = 1; attempt <= config.webhookRetryCount; attempt++) {
      try {
        const response = await fetch(config.webhookUrl!, {
          method: 'POST',
          headers,
          body,
        });

        if (response.ok) {
          circuitBreaker.recordSuccess();
          logger.debug('Webhook delivered', {
            event: payload.event,
            statusCode: response.status,
            attempt,
          });
          return;
        }

        logger.warn('Webhook failed', {
          event: payload.event,
          statusCode: response.status,
          attempt,
        });
      } catch (err) {
        logger.warn('Webhook error', {
          event: payload.event,
          error: String(err),
          attempt,
        });
      }

      if (attempt < config.webhookRetryCount) {
        await sleep(config.webhookRetryDelay);
      }
    }

    circuitBreaker.recordFailure();
    logger.error('Webhook failed after all retries', {
      event: payload.event,
      url: config.webhookUrl,
    });
  }

  function createPayload(event: string, data: Record<string, unknown>): WebhookPayload {
    return {
      event,
      // `||` y no `??`: un mensaje sin sesión trae `sessionId: ''`, y un instanceId vacío no
      // identifica a nadie.
      instanceId: (data['sessionId'] as string | undefined) || config.instanceName,
      timestamp: new Date().toISOString(),
      data,
    };
  }

  return {
    start() {
      active = true;

      // Una edición conserva el `id` del mensaje original. Entregada como `message`, el consumidor
      // la tomaría por un mensaje nuevo del cliente; por eso va aparte y solo a quien la pide.
      const wantsMessage = allowedEvents.has('message');
      const wantsEdit = allowedEvents.has('message.edit');
      if (wantsMessage || wantsEdit) {
        for (const eventName of MESSAGE_EVENT_NAMES) {
          eventBus.on(eventName, (data) => {
            if (!active) return;
            const isEdit = (data as { isEdit?: boolean }).isEdit === true;
            if (isEdit ? !wantsEdit : !wantsMessage) return;
            deliver(createPayload(isEdit ? 'message.edit' : 'message', data as unknown as Record<string, unknown>));
          });
        }
      }

      if (allowedEvents.has('media') || allowedEvents.has('media.downloaded')) {
        eventBus.on('media.downloaded', (data) => {
          if (!active) return;
          deliver(createPayload('media.downloaded', data as unknown as Record<string, unknown>));
        });
      }

      eventBus.on('connection.update', (data) => {
        if (!active || !allowedEvents.has('connection')) return;
        deliver(createPayload('connection', data as unknown as Record<string, unknown>));
      });

      eventBus.on('qr', (data) => {
        if (!active || !allowedEvents.has('qr')) return;
        deliver(createPayload('qr', data as unknown as Record<string, unknown>));
      });

      eventBus.on('presence.contact', (data) => {
        if (!active || !allowedEvents.has('presence')) return;
        deliver(createPayload('presence', data as unknown as Record<string, unknown>));
      });

      eventBus.on('message.status', (data) => {
        if (!active || !allowedEvents.has('message.status')) return;
        deliver(createPayload('message.status', data as unknown as Record<string, unknown>));
      });

      // Llamadas entrantes: de una misma llamada salen varios eventos (offer, accept, reject,
      // timeout, terminate) con el mismo `id`, para tratarlos como actualizaciones de un registro.
      eventBus.on('call', (data) => {
        if (!active || !allowedEvents.has('call')) return;
        deliver(createPayload('call', data as unknown as Record<string, unknown>));
      });

      // Histórico al emparejar una línea. Va en eventos propios y nunca como `message`: son
      // conversaciones de hace meses y un consumidor que las tomara por recién llegadas
      // contestaría a todas.
      if (allowedEvents.has('history')) {
        eventBus.on('message.history', (data) => {
          if (!active) return;
          deliver(createPayload('message.history', data as unknown as Record<string, unknown>));
        });
        eventBus.on('history.synced', (data) => {
          if (!active) return;
          deliver(createPayload('history.synced', data as unknown as Record<string, unknown>));
        });
      }

      logger.info('Webhook dispatcher started', {
        url: config.webhookUrl,
        events: [...allowedEvents],
      });
    },

    stop() {
      active = false;
      logger.info('Webhook dispatcher stopped');
    },
  };
}
