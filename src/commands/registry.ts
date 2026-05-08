import type { EventBus } from '../core/event-bus';
import type { Logger } from '../utils/logger';
import type { Command, CommandRegistry, NormalizedMessage } from '../types';

export function createCommandRegistry(
  eventBus: EventBus,
  sendReply: (to: string, text: string) => Promise<string>,
  logger: Logger,
  prefix = '!',
): CommandRegistry {
  const commands = new Map<string, Command>();
  let unsub: (() => void) | null = null;

  function normalize(name: string): string {
    return name.toLowerCase().trim();
  }

  function collectKeysOf(cmd: Command): string[] {
    const keys: string[] = [];
    for (const [key, value] of commands) {
      if (value === cmd) keys.push(key);
    }
    return keys;
  }

  function collectUnique(): Command[] {
    const seen = new Set<Command>();
    const result: Command[] = [];
    for (const cmd of commands.values()) {
      if (!seen.has(cmd)) {
        seen.add(cmd);
        result.push(cmd);
      }
    }
    return result;
  }

  async function handleMessage(msg: NormalizedMessage): Promise<void> {
    const body = msg.body;
    if (!body) return;
    if (!body.startsWith(prefix)) return;

    const afterPrefix = body.slice(prefix.length).trimStart();
    const parts = afterPrefix.split(/\s+/);
    const cmdName = parts[0];
    if (!cmdName) return;

    const args = parts.slice(1);
    const cmd = commands.get(normalize(cmdName));
    if (!cmd) return;

    logger.debug('Command executed', {
      command: cmdName,
      from: msg.from,
      args: args.join(' '),
    });

    try {
      const reply = (text: string) => sendReply(msg.from, text);
      await cmd.handler(msg, args, reply);
    } catch (err) {
      logger.error('Command handler error', {
        command: cmdName,
        error: String(err),
      });
    }
  }

  return {
    register(command: Command): void {
      commands.set(normalize(command.name), command);
      for (const alias of command.aliases ?? []) {
        commands.set(normalize(alias), command);
      }
      logger.debug('Command registered', { name: command.name, aliases: command.aliases });
    },

    unregister(name: string): void {
      const key = normalize(name);
      const cmd = commands.get(key);
      if (!cmd) return;
      const allKeys = collectKeysOf(cmd);
      for (const k of allKeys) {
        commands.delete(k);
      }
    },

    get(name: string): Command | undefined {
      return commands.get(normalize(name));
    },

    getAll(): Command[] {
      return collectUnique();
    },

    start(): void {
      unsub = eventBus.on('message.text', handleMessage);
      logger.info('Command registry started', { prefix });
    },

    stop(): void {
      if (unsub) {
        unsub();
        unsub = null;
      }
      logger.info('Command registry stopped');
    },
  };
}
