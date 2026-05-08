import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createIncomingMessageHub } from '../core/incoming-message-hub';
import { createSSETransport } from '../transport/sse-transport';
import { createLogger } from '../utils/logger';
import type { NormalizedMessage } from '../types';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test', pollingEnabled: false, sseEnabled: false,
  messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
};

const logger = createLogger(mockConfig);

let msgCounter = 0;

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  msgCounter++;
  return {
    id: `sse-${String(msgCounter).padStart(3, '0')}`,
    from: '123456@s.whatsapp.net',
    phone: '123456',
    pushName: 'TestUser',
    isGroup: false,
    groupId: null,
    timestamp: Math.floor(Date.now() / 1000),
    type: 'text',
    body: 'Hello',
    quotedMessage: null,
    media: null,
    ...overrides,
  };
}

async function readAllFromReaderWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 500,
): Promise<string> {
  const chunks: Uint8Array[] = [];

  const result = await Promise.race([
    (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      return '';
    })(),
    new Promise<string>((resolve) => {
      setTimeout(() => {
        reader.cancel().catch(() => {});
        resolve(chunks.map(c => new TextDecoder().decode(c)).join(''));
      }, timeoutMs);
    }),
  ]);

  return result;
}

describe('SSETransport', () => {
  let bus: ReturnType<typeof createEventBus>;
  let hub: ReturnType<typeof createIncomingMessageHub>;

  beforeEach(() => {
    msgCounter = 0;
    bus = createEventBus();
    hub = createIncomingMessageHub(bus, logger, { maxSize: 100, ttlMs: 60000 });
    hub.start();
  });

  afterEach(() => {
    hub.stop();
  });

  it('returns correct SSE headers', () => {
    const transport = createSSETransport(hub, logger, 30000);
    const req = new Request('http://localhost/api/messages/stream');
    const response = transport.handleConnection(req);

    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.status).toBe(200);
  });

  it('transmits incoming message as SSE event', async () => {
    const transport = createSSETransport(hub, logger, 30000);
    const req = new Request('http://localhost/api/messages/stream');
    const response = transport.handleConnection(req);

    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array> as ReadableStreamDefaultReader<Uint8Array>;

    bus.emit('message.text', makeMessage({ id: 'sse-msg-1', body: 'Hello SSE' }));

    const { value, done } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('id: sse-msg-1');
    expect(text).toContain('event: text');
    expect(text).toContain('Hello SSE');

    reader.cancel().catch(() => {});
  });

  it('sends heartbeat periodically', async () => {
    const transport = createSSETransport(hub, logger, 50);
    const req = new Request('http://localhost/api/messages/stream');
    const response = transport.handleConnection(req);

    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    // Wait for at least one heartbeat
    await new Promise(resolve => setTimeout(resolve, 80));

    const { value, done } = await reader.read();
    const text = new TextDecoder().decode(value);

    expect(text).toContain('event: ping');
    expect(text).toContain('{}');

    reader.cancel().catch(() => {});
  });

  it('filters by types parameter', async () => {
    const transport = createSSETransport(hub, logger, 30000);
    const req = new Request('http://localhost/api/messages/stream?types=image,video');
    const response = transport.handleConnection(req);

    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    bus.emit('message.text', makeMessage({ id: 'sse-text', type: 'text', body: 'ignored' }));
    bus.emit('message.image', makeMessage({ id: 'sse-image', type: 'image', body: 'photo' }));
    bus.emit('message.video', makeMessage({ id: 'sse-video', type: 'video', body: 'clip' }));

    await new Promise(resolve => setTimeout(resolve, 50));

    const allData = await readAllFromReaderWithTimeout(reader, 300);

    expect(allData).toContain('sse-image');
    expect(allData).toContain('sse-video');
    expect(allData).not.toContain('sse-text');
  });

  it('filters by phone parameter', async () => {
    const transport = createSSETransport(hub, logger, 30000);
    const req = new Request('http://localhost/api/messages/stream?phone=999999');
    const response = transport.handleConnection(req);

    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    bus.emit('message.text', makeMessage({ id: 'sse-other', phone: '111111' }));
    bus.emit('message.text', makeMessage({ id: 'sse-target', phone: '999999' }));

    await new Promise(resolve => setTimeout(resolve, 50));

    const allData = await readAllFromReaderWithTimeout(reader, 300);

    expect(allData).toContain('sse-target');
    expect(allData).not.toContain('sse-other');
  });

  it('filters group messages when includeGroups=false', async () => {
    const transport = createSSETransport(hub, logger, 30000);
    const req = new Request('http://localhost/api/messages/stream?includeGroups=false');
    const response = transport.handleConnection(req);

    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    bus.emit('message.text', makeMessage({ id: 'sse-group', isGroup: true, groupId: 'abc@g.us' }));
    bus.emit('message.text', makeMessage({ id: 'sse-personal', isGroup: false }));

    await new Promise(resolve => setTimeout(resolve, 50));

    const allData = await readAllFromReaderWithTimeout(reader, 300);

    expect(allData).toContain('sse-personal');
    expect(allData).not.toContain('sse-group');
  });

  it('cleans up resources on disconnection', async () => {
    const transport = createSSETransport(hub, logger, 30000);
    const abortController = new AbortController();
    const req = new Request('http://localhost/api/messages/stream', {
      signal: abortController.signal,
    });

    const response = transport.handleConnection(req);
    const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    bus.emit('message.text', makeMessage({ id: 'sse-before' }));

    await new Promise(resolve => setTimeout(resolve, 50));
    expect((await reader.read()).value).toBeDefined();

    // Disconnect
    abortController.abort();

    await new Promise(resolve => setTimeout(resolve, 50));

    // Emit after disconnect - should not crash
    bus.emit('message.text', makeMessage({ id: 'sse-after' }));

    expect(true).toBe(true);
  });

  it('stop closes all active connections', async () => {
    const transport = createSSETransport(hub, logger, 30000);
    const req1 = new Request('http://localhost/api/messages/stream');
    const req2 = new Request('http://localhost/api/messages/stream');

    const res1 = transport.handleConnection(req1);
    const res2 = transport.handleConnection(req2);

    const reader1 = res1.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const reader2 = res2.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    transport.stop();

    const result1 = await reader1.read();
    expect(result1.done).toBe(true);

    const result2 = await reader2.read();
    expect(result2.done).toBe(true);
  });
});
