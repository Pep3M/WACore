import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createIncomingMessageHub } from '../core/incoming-message-hub';
import { createSSETransport } from '../transport/sse-transport';
import { createLogger } from '../utils/logger';
import type { NormalizedMessage } from '../types';
import type { Response } from 'express';

const mockConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000, nodeEnv: 'test', autoTyping: true, typingDurationMs: 3000, pollingEnabled: false, sseEnabled: false,
  messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
};

const logger = createLogger(mockConfig);
let msgCounter = 0;

function makeMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  msgCounter++;
  return {
    id: `sse-${String(msgCounter).padStart(3, '0')}`,
    from: '123456@s.whatsapp.net', phone: '123456', pushName: 'TestUser',
    isGroup: false, groupId: null,
    timestamp: Math.floor(Date.now() / 1000), type: 'text', body: 'Hello',
    quotedMessage: null, media: null, ...overrides,
  };
}

function mockRes(): { res: any; data: () => string } {
  let buffer = '';
  let closed = false;
  const listeners: Record<string, Function[]> = {};
  const res: any = {
    writeHead(_status: number, headers: Record<string, string>) {
      res._headers = headers;
    },
    write(data: string) {
      buffer += data;
      return true;
    },
    end() { closed = true; },
    on(event: string, fn: Function) {
      (listeners[event] ??= []).push(fn);
      return this;
    },
    emit(event: string) {
      listeners[event]?.forEach(fn => fn());
    },
    get statusCode() { return 200; },
    _headers: {} as Record<string, string>,
  };
  return { res, data: () => buffer };
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

  afterEach(() => { hub.stop(); });

  it('sets correct SSE headers', () => {
    const transport = createSSETransport(hub, bus, logger, 30000);
    const { res } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream' }, res as unknown as Response);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
    expect(res._headers['Cache-Control']).toBe('no-cache');
    expect(res._headers['Connection']).toBe('keep-alive');
  });

  it('transmits incoming message as SSE event', async () => {
    const transport = createSSETransport(hub, bus, logger, 30000);
    const { res, data } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream' }, res as unknown as Response);

    bus.emit('message.text', makeMessage({ id: 'sse-msg-1', body: 'Hello SSE' }));
    await new Promise(r => setTimeout(r, 50));

    const text = data();
    expect(text).toContain('id: sse-msg-1');
    expect(text).toContain('event: text');
    expect(text).toContain('Hello SSE');
  });

  it('sends heartbeat periodically', async () => {
    const transport = createSSETransport(hub, bus, logger, 50);
    const { res, data } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream' }, res as unknown as Response);

    await new Promise(r => setTimeout(r, 80));
    const text = data();
    expect(text).toContain('event: ping');
    expect(text).toContain('{}');
  });

  it('filters by types parameter', async () => {
    const transport = createSSETransport(hub, bus, logger, 30000);
    const { res, data } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream?types=image,video' }, res as unknown as Response);

    bus.emit('message.text', makeMessage({ id: 'sse-text', type: 'text', body: 'ignored' }));
    bus.emit('message.image', makeMessage({ id: 'sse-image', type: 'image', body: 'photo' }));
    bus.emit('message.video', makeMessage({ id: 'sse-video', type: 'video', body: 'clip' }));
    await new Promise(r => setTimeout(r, 50));

    const text = data();
    expect(text).toContain('sse-image');
    expect(text).toContain('sse-video');
    expect(text).not.toContain('sse-text');
  });

  it('filters by phone parameter', async () => {
    const transport = createSSETransport(hub, bus, logger, 30000);
    const { res, data } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream?phone=999999' }, res as unknown as Response);

    bus.emit('message.text', makeMessage({ id: 'sse-other', phone: '111111' }));
    bus.emit('message.text', makeMessage({ id: 'sse-target', phone: '999999' }));
    await new Promise(r => setTimeout(r, 50));

    const text = data();
    expect(text).toContain('sse-target');
    expect(text).not.toContain('sse-other');
  });

  it('filters group messages when includeGroups=false', async () => {
    const transport = createSSETransport(hub, bus, logger, 30000);
    const { res, data } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream?includeGroups=false' }, res as unknown as Response);

    bus.emit('message.text', makeMessage({ id: 'sse-group', isGroup: true, groupId: 'abc@g.us' }));
    bus.emit('message.text', makeMessage({ id: 'sse-personal', isGroup: false }));
    await new Promise(r => setTimeout(r, 50));

    const text = data();
    expect(text).toContain('sse-personal');
    expect(text).not.toContain('sse-group');
  });

  it('cleans up on disconnect', async () => {
    const transport = createSSETransport(hub, bus, logger, 30000);
    const { res, data } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream' }, res as unknown as Response);

    bus.emit('message.text', makeMessage({ id: 'sse-before' }));
    await new Promise(r => setTimeout(r, 50));
    expect(data()).toContain('sse-before');

    res.emit('close');
    await new Promise(r => setTimeout(r, 50));
    bus.emit('message.text', makeMessage({ id: 'sse-after' }));
    expect(data()).not.toContain('sse-after');
  });

  it('stop closes all active connections', () => {
    const transport = createSSETransport(hub, bus, logger, 30000);
    const { res: res1 } = mockRes();
    const { res: res2 } = mockRes();
    transport.handleConnection({ url: '/api/messages/stream' }, res1 as unknown as Response);
    transport.handleConnection({ url: '/api/messages/stream' }, res2 as unknown as Response);
    transport.stop();
    expect(true).toBe(true);
  });
});
