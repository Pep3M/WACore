import type { Response } from 'express';
import type { Logger } from '../utils/logger';
import type { NormalizedMessage, ConnectionUpdateEvent, PresenceContactEvent, MessageStatusEvent, CallEvent } from '../types';
import type { IncomingMessageHub } from '../core/incoming-message-hub';
import type { EventBus } from '../core/event-bus';

export interface SSETransport {
  handleConnection(req: { url: string; signal?: AbortSignal }, res: Response): void;
  stop(): void;
}

export function createSSETransport(
  incomingHub: IncomingMessageHub,
  eventBus: EventBus,
  logger: Logger,
  heartbeatMs: number,
): SSETransport {
  interface StreamEntry {
    res: Response;
    heartbeatTimer: ReturnType<typeof setInterval>;
    unsubMsg: () => void;
  }

  const activeStreams = new Map<Response, StreamEntry>();
  let unsubConnection: (() => void) | null = null;
  let unsubPresence: (() => void) | null = null;
  let unsubMessageStatus: (() => void) | null = null;
  let unsubCall: (() => void) | null = null;

  function broadcastToAll(event: string, data: string): void {
    for (const { res } of activeStreams.values()) {
      try { res.write(`event: ${event}\ndata: ${data}\n\n`); } catch { /* stream closed */ }
    }
  }

  function handleConnection(req: { url: string; signal?: AbortSignal }, res: Response): void {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const typesFilter = parsedUrl.searchParams.get('types');
    const phoneFilter = parsedUrl.searchParams.get('phone');
    const includeGroups = parsedUrl.searchParams.get('includeGroups') !== 'false';
    const allowedTypes = typesFilter ? new Set(typesFilter.split(',').map(s => s.trim())) : null;

    let streamCancelled = false;
    let unsubMsg: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    if (!unsubConnection) {
      unsubConnection = eventBus.on('connection.update', (update: ConnectionUpdateEvent) => {
        broadcastToAll('connection', JSON.stringify({
          status: update.status,
          phone: update.phoneNumber || null,
        }));
      });
    }

    if (!unsubPresence) {
      unsubPresence = eventBus.on('presence.contact', (evt: PresenceContactEvent) => {
        broadcastToAll('presence', JSON.stringify(evt));
      });
    }

    if (!unsubMessageStatus) {
      unsubMessageStatus = eventBus.on('message.status', (evt: MessageStatusEvent) => {
        broadcastToAll('message.status', JSON.stringify(evt));
      });
    }

    if (!unsubCall) {
      unsubCall = eventBus.on('call', (evt: CallEvent) => {
        broadcastToAll('call', JSON.stringify(evt));
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });

    function sendSSE(event: string, data: string, id?: string): void {
      if (streamCancelled) return;
      try {
        let msg = '';
        if (id) msg += `id: ${id}\n`;
        msg += `event: ${event}\n`;
        msg += `data: ${data}\n\n`;
        res.write(msg);
      } catch {
        cleanup();
      }
    }

    function onMessage(msg: NormalizedMessage): void {
      if (streamCancelled) return;
      if (allowedTypes && !allowedTypes.has(msg.type)) return;
      if (phoneFilter && msg.phone !== phoneFilter) return;
      if (!includeGroups && msg.isGroup) return;
      sendSSE(msg.type, JSON.stringify(msg), msg.id);
    }

    heartbeatTimer = setInterval(() => {
      sendSSE('ping', '{}');
    }, heartbeatMs);

    unsubMsg = incomingHub.registerHandler(onMessage);

    activeStreams.set(res, { res, heartbeatTimer, unsubMsg });

    function cleanup(): void {
      if (streamCancelled) return;
      streamCancelled = true;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (unsubMsg) { unsubMsg(); unsubMsg = null; }
      activeStreams.delete(res);
      try { res.end(); } catch { /* already ended */ }
    }

    if (req.signal) {
      req.signal.addEventListener('abort', cleanup, { once: true });
    }

    res.on('close', cleanup);
  }

  function stop(): void {
    for (const entry of activeStreams.values()) {
      clearInterval(entry.heartbeatTimer);
      entry.unsubMsg();
      try { entry.res.end(); } catch { /* already ended */ }
    }
    activeStreams.clear();
    if (unsubConnection) {
      unsubConnection();
      unsubConnection = null;
    }
    if (unsubPresence) {
      unsubPresence();
      unsubPresence = null;
    }
    if (unsubCall) {
      unsubCall();
      unsubCall = null;
    }
    if (unsubMessageStatus) {
      unsubMessageStatus();
      unsubMessageStatus = null;
    }
    logger.info('SSE transport stopped');
  }

  return { handleConnection, stop };
}
