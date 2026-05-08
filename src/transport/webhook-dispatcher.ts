import type { EventBus } from '../core/event-bus';
import type { Logger } from '../utils/logger';
import type { EnvConfig, WebhookPayload, WACoreEventName } from '../types';
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
      'X-WACore-Instance': config.instanceName,
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
      instanceId: config.instanceName,
      timestamp: new Date().toISOString(),
      data,
    };
  }

  return {
    start() {
      active = true;

      if (allowedEvents.has('message')) {
        const messageEvents: WACoreEventName[] = [
          'message.text', 'message.image', 'message.video',
          'message.document', 'message.audio', 'message.reaction',
        ];
        for (const eventName of messageEvents) {
          eventBus.on(eventName, (data) => {
            if (!active) return;
            deliver(createPayload('message', data as unknown as Record<string, unknown>));
          });
        }
      }

      eventBus.on('connection.update', (data) => {
        if (!active || !allowedEvents.has('connection')) return;
        deliver(createPayload('connection', data as unknown as Record<string, unknown>));
      });

      eventBus.on('qr', (data) => {
        if (!active || !allowedEvents.has('qr')) return;
        deliver(createPayload('qr', data as unknown as Record<string, unknown>));
      });

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
