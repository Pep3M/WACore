import { mkdirSync, unlinkSync } from 'node:fs';
import { access, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { BufferJSON } from 'baileys/lib/Utils/generics.js';
import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from './session-store';

const BACKUP_COUNT = 3;

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export class FileStore implements SessionStore {
  private baseDir: string;
  private logger: Logger;

  constructor(config: EnvConfig, logger: Logger) {
    this.baseDir = `${config.sessionDir}/${config.instanceName}`;
    this.logger = logger;
    this.ensureDir();
  }

  private ensureDir(): void {
    try {
      mkdirSync(this.baseDir, { recursive: true });
    } catch {
      // directorio padre no existe, writeFile creará el archivo igualmente
    }
  }

  private credsPath(): string {
    return `${this.baseDir}/creds.json`;
  }

  private keysPath(): string {
    return `${this.baseDir}/keys.json`;
  }

  async exists(): Promise<boolean> {
    try {
      return await fileExists(this.credsPath());
    } catch {
      return false;
    }
  }

  async load(): Promise<{ creds: unknown; keys: unknown } | null> {
    try {
      const credsOk = await fileExists(this.credsPath());
      const keysOk = await fileExists(this.keysPath());

      if (!credsOk || !keysOk) {
        return null;
      }

      const rawCreds = await readFile(this.credsPath(), 'utf-8');
      const rawKeys = await readFile(this.keysPath(), 'utf-8');
      const creds = JSON.parse(rawCreds, BufferJSON.reviver);
      const keys = JSON.parse(rawKeys, BufferJSON.reviver);

      this.logger.info('Session loaded from file store');
      return { creds, keys };
    } catch (err) {
      this.logger.error('Failed to load session', { error: String(err) });
      await this.restoreFromBackup();
      return null;
    }
  }

  async save(creds: unknown, keys: unknown): Promise<void> {
    await this.backup();
    try {
      await writeFile(this.credsPath(), JSON.stringify(creds, BufferJSON.replacer, 2));
      await writeFile(this.keysPath(), JSON.stringify(keys, BufferJSON.replacer, 2));
      this.logger.debug('Session saved');
    } catch (err) {
      this.logger.error('Failed to save session', { error: String(err) });
    }
  }

  async delete(): Promise<void> {
    try {
      try { unlinkSync(this.credsPath()); } catch {}
      try { unlinkSync(this.keysPath()); } catch {}
      this.logger.warn('Session deleted');
    } catch (err) {
      this.logger.error('Failed to delete session', { error: String(err) });
    }
  }

  async backup(): Promise<void> {
    try {
      await stat(this.baseDir); // ensure dir exists

      for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
        const oldCreds = `${this.baseDir}/creds.json.bak.${i}`;
        const oldKeys = `${this.baseDir}/keys.json.bak.${i}`;
        const newCreds = `${this.baseDir}/creds.json.bak.${i + 1}`;
        const newKeys = `${this.baseDir}/keys.json.bak.${i + 1}`;

        if (await fileExists(oldCreds)) await copyFile(oldCreds, newCreds);
        if (await fileExists(oldKeys)) await copyFile(oldKeys, newKeys);
      }

      if (await fileExists(this.credsPath())) {
        await copyFile(this.credsPath(), `${this.baseDir}/creds.json.bak.1`);
        await copyFile(this.keysPath(), `${this.baseDir}/keys.json.bak.1`);
      }
    } catch (err) {
      this.logger.warn('Backup failed', { error: String(err) });
    }
  }

  private async restoreFromBackup(): Promise<void> {
    for (let i = 1; i <= BACKUP_COUNT; i++) {
      const credsBak = `${this.baseDir}/creds.json.bak.${i}`;
      const keysBak = `${this.baseDir}/keys.json.bak.${i}`;

      if (await fileExists(credsBak) && await fileExists(keysBak)) {
        await copyFile(credsBak, this.credsPath());
        await copyFile(keysBak, this.keysPath());
        this.logger.info('Session restored from backup', { backup: i });
        return;
      }
    }
    this.logger.warn('No backup available to restore');
  }
}
