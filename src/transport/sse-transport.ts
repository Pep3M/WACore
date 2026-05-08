import type { Logger } from '../utils/logger';
import type { NormalizedMessage } from '../types';
import type { IncomingMessageHub } from '../core/incoming-message-hub';

export interface SSETransport {
  handleConnection(req: Request): Response;
  stop(): void;
}

export function createSSETransport(
  incomingHub: IncomingMessageHub,
  logger: Logger,
  heartbeatMs: number,
): SSETransport {
  interface StreamEntry {
    controller: ReadableStreamDefaultController;
    heartbeatTimer: ReturnType<typeof setInterval>;
    unsubHandler: () => void;
  }

  const activeStreams = new Map<ReadableStreamDefaultController, StreamEntry>();

  function handleConnection(req: Request): Response {
    const url = new URL(req.url);
    const typesFilter = url.searchParams.get('types');
    const phoneFilter = url.searchParams.get('phone');
    const includeGroups = url.searchParams.get('includeGroups') !== 'false';
    const allowedTypes = typesFilter ? new Set(typesFilter.split(',').map(s => s.trim())) : null;

    let streamCancelled = false;
    let unsubHandler: (() => void) | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let streamController: ReadableStreamDefaultController | null = null;

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;

        const encoder = new TextEncoder();

        function sendSSE(event: string, data: string, id?: string): void {
          if (streamCancelled) return;
          try {
            let msg = '';
            if (id) msg += `id: ${id}\n`;
            msg += `event: ${event}\n`;
            msg += `data: ${data}\n\n`;
            controller.enqueue(encoder.encode(msg));
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

        unsubHandler = incomingHub.registerHandler(onMessage);
        heartbeatTimer = setInterval(() => {
          sendSSE('ping', '{}');
        }, heartbeatMs);

        activeStreams.set(controller, { controller, heartbeatTimer, unsubHandler });

        function cleanup(): void {
          if (streamCancelled) return;
          streamCancelled = true;
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (unsubHandler) unsubHandler();
          if (streamController) activeStreams.delete(streamController);
          try { controller.close(); } catch { /* already closed */ }
        }

        if (req.signal) {
          req.signal.addEventListener('abort', cleanup, { once: true });
        }
      },
      cancel() {
        streamCancelled = true;
        if (streamController) {
          const entry = activeStreams.get(streamController);
          if (entry) {
            clearInterval(entry.heartbeatTimer);
            entry.unsubHandler();
            activeStreams.delete(streamController);
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }

  function stop(): void {
    for (const entry of activeStreams.values()) {
      clearInterval(entry.heartbeatTimer);
      entry.unsubHandler();
      try { entry.controller.close(); } catch { /* already closed */ }
    }
    activeStreams.clear();
    logger.info('SSE transport stopped');
  }

  return { handleConnection, stop };
}
