import type { WACoreEventMap, WACoreEventName } from '../types';

type EventHandler<E extends WACoreEventName> = (data: WACoreEventMap[E]) => void | Promise<void>;

interface HandlerEntry {
  handler: EventHandler<any>;
  once: boolean;
}

export interface EventBus {
  on<E extends WACoreEventName>(event: E, handler: EventHandler<E>): () => void;
  once<E extends WACoreEventName>(event: E, handler: EventHandler<E>): () => void;
  off<E extends WACoreEventName>(event: E, handler: EventHandler<E>): void;
  emit<E extends WACoreEventName>(event: E, data: WACoreEventMap[E]): void;
  removeAllListeners(): void;
  listenerCount(event: WACoreEventName): number;
}

export function createEventBus(): EventBus {
  const listeners = new Map<string, HandlerEntry[]>();

  function getHandlers(event: string): HandlerEntry[] {
    let handlers = listeners.get(event);
    if (!handlers) {
      handlers = [];
      listeners.set(event, handlers);
    }
    return handlers;
  }

  return {
    on(event, handler) {
      getHandlers(event).push({ handler, once: false });
      return () => this.off(event, handler);
    },

    once(event, handler) {
      getHandlers(event).push({ handler, once: true });
      return () => this.off(event, handler);
    },

    off(event, handler) {
      const handlers = listeners.get(event);
      if (!handlers) return;
      const idx = handlers.findIndex(h => h.handler === handler);
      if (idx >= 0) handlers.splice(idx, 1);
    },

    emit(event, data) {
      const handlers = [...(listeners.get(event) ?? [])];
      for (const entry of handlers) {
        if (entry.once) this.off(event, entry.handler);
        try {
          const result = entry.handler(data);
          if (result instanceof Promise) {
            result.catch(err => {
              console.error(`[EventBus] Error in handler for "${event}":`, err);
            });
          }
        } catch (err) {
          console.error(`[EventBus] Error in handler for "${event}":`, err);
        }
      }
    },

    removeAllListeners() {
      listeners.clear();
    },

    listenerCount(event) {
      return listeners.get(event)?.length ?? 0;
    },
  };
}
