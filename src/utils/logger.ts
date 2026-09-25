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

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const LEVEL_STYLE: Record<LogLevel, { color: string; label: string }> = {
  debug: { color: ANSI.gray, label: 'DEBUG' },
  info: { color: ANSI.green, label: 'INFO ' },
  warn: { color: ANSI.yellow, label: 'WARN ' },
  error: { color: ANSI.red, label: 'ERROR' },
};

function shortTime(iso: string): string {
  // HH:MM:SS.mmm from an ISO string
  return iso.slice(11, 23);
}

function formatCtx(ctx: Record<string, unknown>, useColor: boolean): string {
  const keys = Object.keys(ctx);
  if (keys.length === 0) return '';
  const parts: string[] = [];
  for (const k of keys) {
    const v = ctx[k];
    let s: string;
    if (v === null || v === undefined) s = String(v);
    else if (typeof v === 'string') s = v;
    else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
    else {
      try { s = JSON.stringify(v); } catch { s = String(v); }
    }
    if (s.length > 200) s = s.slice(0, 197) + '...';
    parts.push(useColor ? `${ANSI.cyan}${k}${ANSI.reset}=${s}` : `${k}=${s}`);
  }
  return ' ' + parts.join(' ');
}

function formatPretty(entry: LogEntry, useColor: boolean): string {
  const { level: _lvl, levelName, time, instance, msg, ...rest } = entry;
  const style = LEVEL_STYLE[levelName];
  const t = shortTime(time);
  const source = typeof rest.source === 'string' ? rest.source : undefined;
  if (source) delete rest.source;

  const tag = source ? `${instance}/${source}` : instance;

  if (useColor) {
    return (
      `${ANSI.dim}${t}${ANSI.reset} ` +
      `${style.color}${style.label}${ANSI.reset} ` +
      `${ANSI.magenta}[${tag}]${ANSI.reset} ` +
      `${msg}` +
      `${ANSI.gray}${formatCtx(rest, false)}${ANSI.reset}`
    );
  }
  return `${t} ${style.label} [${tag}] ${msg}${formatCtx(rest, false)}`;
}

export function createLogger(config: EnvConfig): Logger {
  const minLevel = LEVEL_NUM[config.logLevel] ?? LEVEL_NUM.info;
  const instance = config.instanceName;
  const pretty = config.logFormat === 'pretty';
  const useColor = pretty && !!process.stdout.isTTY;

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

    const output = pretty ? formatPretty(entry, useColor) : JSON.stringify(entry);
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
