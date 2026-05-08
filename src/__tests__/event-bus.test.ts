import { describe, expect, it, mock } from 'bun:test';
import { createEventBus } from '../core/event-bus';

describe('EventBus', () => {
  it('emits and receives events', () => {
    const bus = createEventBus();
    const handler = mock();
    bus.on('connection.update', handler);
    bus.emit('connection.update', { status: 'connected', previous: 'connecting' });
    expect(handler).toHaveBeenCalledWith({ status: 'connected', previous: 'connecting' });
  });

  it('unsubscribes via returned function', () => {
    const bus = createEventBus();
    const handler = mock();
    const unsub = bus.on('qr', handler);
    unsub();
    bus.emit('qr', { qr: 'data', timeout: 30000 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes via off', () => {
    const bus = createEventBus();
    const handler = mock();
    bus.on('qr', handler);
    bus.off('qr', handler);
    bus.emit('qr', { qr: 'data', timeout: 30000 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires once handlers only once', () => {
    const bus = createEventBus();
    const handler = mock();
    bus.once('qr', handler);
    bus.emit('qr', { qr: 'first', timeout: 30000 });
    bus.emit('qr', { qr: 'second', timeout: 30000 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('counts listeners', () => {
    const bus = createEventBus();
    expect(bus.listenerCount('message')).toBe(0);
    const h1 = mock();
    const h2 = mock();
    bus.on('message', h1);
    bus.on('message', h2);
    expect(bus.listenerCount('message')).toBe(2);
    bus.off('message', h1);
    expect(bus.listenerCount('message')).toBe(1);
  });

  it('removes all listeners', () => {
    const bus = createEventBus();
    const handler = mock();
    bus.on('error', handler);
    bus.on('qr', handler);
    bus.removeAllListeners();
    bus.emit('error', { source: 'test', message: 'err' });
    bus.emit('qr', { qr: 'data', timeout: 30000 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not crash on async handler rejection', async () => {
    const bus = createEventBus();
    const failingHandler = async () => { throw new Error('handler error'); };
    bus.on('error', failingHandler);
    expect(() => {
      bus.emit('error', { source: 'test', message: 'err' });
    }).not.toThrow();
    await Bun.sleep(0);
  });

  it('handles multiple subscribers', () => {
    const bus = createEventBus();
    const h1 = mock();
    const h2 = mock();
    bus.on('connection.update', h1);
    bus.on('connection.update', h2);
    bus.emit('connection.update', { status: 'connected' });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });
});
