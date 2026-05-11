import { describe, expect, it, mock } from 'bun:test';
import { createEventBus } from '../core/event-bus';
import { createCommandRegistry } from '../commands/registry';
import { createLogger } from '../utils/logger';
import type { NormalizedMessage } from '../types';

const testConfig = {
  instanceName: 'test', healthPort: 9877, apiPort: 9878, logLevel: 'error' as const,
  sessionStore: 'file' as const, sessionDir: '/tmp', webhookEvents: [],
  webhookRetryCount: 0, webhookRetryDelay: 0, connectOnStartup: false,
  qrTimeout: 60000,
  pollingEnabled: false, sseEnabled: false, messageBufferSize: 1000, messageBufferTtlMs: 300000, sseHeartbeatMs: 30000,
  autoTyping: true, typingDurationMs: 3000,
  nodeEnv: 'test',
};

const logger = createLogger(testConfig);

function makeTextMessage(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    id: 'msg-1',
    from: '5215551234567@s.whatsapp.net',
    phone: '5215551234567',
    pushName: 'TestUser',
    isGroup: false,
    groupId: null,
    timestamp: Date.now(),
    type: 'text',
    body: '!ping',
    quotedMessage: null,
    media: null,
    ...overrides,
  };
}

const reply = mock(async () => 'msg-reply-id');

describe('CommandRegistry - Registration', () => {
  it('registers and retrieves a command', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    registry.register({
      name: 'ping',
      description: 'Responde con pong',
      handler: async () => {},
    });

    const cmd = registry.get('ping');
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe('ping');
    expect(cmd?.description).toBe('Responde con pong');
  });

  it('retrieves command by alias', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    registry.register({
      name: 'help',
      aliases: ['h', 'comandos'],
      description: 'Shows help',
      handler: async () => {},
    });

    expect(registry.get('help')).toBeDefined();
    expect(registry.get('h')).toBeDefined();
    expect(registry.get('comandos')).toBeDefined();
  });

  it('is case-insensitive for command names', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    registry.register({
      name: 'Ping',
      description: 'test',
      handler: async () => {},
    });

    expect(registry.get('ping')).toBeDefined();
    expect(registry.get('PING')).toBeDefined();
    expect(registry.get('Ping')).toBeDefined();
  });

  it('unregisters a command and its aliases', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    registry.register({
      name: 'test',
      aliases: ['t', 'ts'],
      description: 'test',
      handler: async () => {},
    });

    registry.unregister('test');

    expect(registry.get('test')).toBeUndefined();
    expect(registry.get('t')).toBeUndefined();
    expect(registry.get('ts')).toBeUndefined();
  });

  it('unregister with alias removes the command', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    registry.register({
      name: 'test',
      aliases: ['t'],
      description: 'test',
      handler: async () => {},
    });

    registry.unregister('t');

    expect(registry.get('test')).toBeUndefined();
    expect(registry.get('t')).toBeUndefined();
  });

  it('getAll returns unique commands (no duplicates from aliases)', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    registry.register({
      name: 'ping',
      aliases: ['p'],
      description: 'Ping',
      handler: async () => {},
    });

    registry.register({
      name: 'help',
      description: 'Help',
      handler: async () => {},
    });

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map(c => c.name).sort()).toEqual(['help', 'ping']);
  });

  it('unregister on non-existent command does nothing', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    expect(() => registry.unregister('nonexistent')).not.toThrow();
  });

  it('registering same name twice overwrites', () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);

    const handler1 = mock();
    const handler2 = mock();

    registry.register({ name: 'test', description: 'v1', handler: handler1 });
    registry.register({ name: 'test', description: 'v2', handler: handler2 });

    const cmd = registry.get('test');
    expect(cmd?.description).toBe('v2');
  });
});

describe('CommandRegistry - Execution', () => {
  it('executes command when message starts with prefix', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock(async (_msg: NormalizedMessage, _args: string[], _reply: any) => {});

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!ping' }));

    expect(handler).toHaveBeenCalledTimes(1);
    registry.stop();
  });

  it('passes correct args to handler', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock(async (_msg: NormalizedMessage, _args: string[], _reply: any) => {});

    registry.register({ name: 'echo', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!echo hello world 123' }));

    expect(handler).toHaveBeenCalledTimes(1);
    const args = handler.mock.calls[0]?.[1];
    expect(args).toEqual(['hello', 'world', '123']);
    registry.stop();
  });

  it('passes reply function that sends to the message sender', async () => {
    const bus = createEventBus();
    const sendReply = mock(async (_to: string, _text: string) => 'reply-id');
    const registry = createCommandRegistry(bus, sendReply, logger);
    const handler = mock(async (_msg: NormalizedMessage, _args: string[], replyFn: any) => {
      await replyFn('Hello back');
    });

    registry.register({ name: 'greet', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!greet' }));

    expect(handler).toHaveBeenCalledTimes(1);
    const replyFn = handler.mock.calls[0]?.[2];
    await replyFn('Hello back');
    expect(sendReply).toHaveBeenCalledWith('5215551234567@s.whatsapp.net', 'Hello back');
    registry.stop();
  });

  it('does NOT execute commands without prefix', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: 'ping' }));

    expect(handler).not.toHaveBeenCalled();
    registry.stop();
  });

  it('does NOT execute unknown commands', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!unknown' }));

    expect(handler).not.toHaveBeenCalled();
    registry.stop();
  });

  it('ignores messages with only prefix and no command', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!' }));

    expect(handler).not.toHaveBeenCalled();
    registry.stop();
  });

  it('handles handler errors gracefully', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock(async () => { throw new Error('oops'); });

    registry.register({ name: 'crash', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!crash' }));

    expect(handler).toHaveBeenCalledTimes(1);
    registry.stop();
  });

  it('executes via alias', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock();

    registry.register({ name: 'help', aliases: ['h'], description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!h' }));

    expect(handler).toHaveBeenCalledTimes(1);
    registry.stop();
  });

  it('handles multiple spaces in command', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!ping   extra   args' }));

    expect(handler).toHaveBeenCalledTimes(1);
    const args = handler.mock.calls[0]?.[1];
    expect(args).toEqual(['extra', 'args']);
    registry.stop();
  });

  it('does nothing for messages with null body', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: null }));

    expect(handler).not.toHaveBeenCalled();
    registry.stop();
  });

  it('stops processing after stop()', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger);
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();
    registry.stop();

    bus.emit('message.text', makeTextMessage({ body: '!ping' }));

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('CommandRegistry - Custom Prefix', () => {
  it('uses custom prefix', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger, '/');
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '/ping' }));

    expect(handler).toHaveBeenCalledTimes(1);
    registry.stop();
  });

  it('does not match default prefix with custom prefix', async () => {
    const bus = createEventBus();
    const registry = createCommandRegistry(bus, reply, logger, '/');
    const handler = mock();

    registry.register({ name: 'ping', description: 'test', handler });
    registry.start();

    bus.emit('message.text', makeTextMessage({ body: '!ping' }));

    expect(handler).not.toHaveBeenCalled();
    registry.stop();
  });
});
