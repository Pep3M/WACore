import type { EnvConfig } from '../types';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_NUM: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry {
  level: number;
  levelName: LogLevel;
  time: string;
  instance: string;
  event?: string;
  msg: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(context: Record<string, unknown>): Logger;
}

export function createLogger(config: EnvConfig): Logger {
  const minLevel = LEVEL_NUM[config.logLevel] ?? LEVEL_NUM.info;
  const instance = config.instanceName;

  function log(levelName: LogLevel, msg: string, ctx?: Record<string, unknown>): void {
    const levelNum = LEVEL_NUM[levelName];
    if (levelNum < minLevel) return;

    const entry: LogEntry = {
      level: levelNum,
      levelName,
      time: new Date().toISOString(),
      instance,
      msg,
      ...ctx,
    };

    const output = JSON.stringify(entry);
    if (levelNum >= LEVEL_NUM.error) {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  return {
    debug: (msg, ctx?) => log('debug', msg, ctx),
    info: (msg, ctx?) => log('info', msg, ctx),
    warn: (msg, ctx?) => log('warn', msg, ctx),
    error: (msg, ctx?) => log('error', msg, ctx),
    child: (context: Record<string, unknown>): Logger => ({
      debug: (msg, ctx?) => log('debug', msg, { ...context, ...ctx }),
      info: (msg, ctx?) => log('info', msg, { ...context, ...ctx }),
      warn: (msg, ctx?) => log('warn', msg, { ...context, ...ctx }),
      error: (msg, ctx?) => log('error', msg, { ...context, ...ctx }),
      child: () => { throw new Error('Nested child loggers not supported'); },
    }),
  };
}
