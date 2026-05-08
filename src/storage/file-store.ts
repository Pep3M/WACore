import { mkdirSync, unlinkSync } from 'node:fs';
import type { Logger } from '../utils/logger';
import type { EnvConfig } from '../types';
import type { SessionStore } from './session-store';

const BACKUP_COUNT = 3;

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
      // directorio padre no existe, Bun.write creará el archivo igualmente
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
      const file = Bun.file(this.credsPath());
      return await file.exists();
    } catch {
      return false;
    }
  }

  async load(): Promise<{ creds: unknown; keys: unknown } | null> {
    try {
      const credsFile = Bun.file(this.credsPath());
      const keysFile = Bun.file(this.keysPath());

      if (!(await credsFile.exists()) || !(await keysFile.exists())) {
        return null;
      }

      const creds = await credsFile.json();
      const keys = await keysFile.json();

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
      await Bun.write(this.credsPath(), JSON.stringify(creds, null, 2));
      await Bun.write(this.keysPath(), JSON.stringify(keys, null, 2));
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
      const dir = Bun.file(this.baseDir);
      await dir.exists(); // ensure dir exists

      for (let i = BACKUP_COUNT - 1; i >= 1; i--) {
        const oldCreds = `${this.baseDir}/creds.json.bak.${i}`;
        const oldKeys = `${this.baseDir}/keys.json.bak.${i}`;
        const newCreds = `${this.baseDir}/creds.json.bak.${i + 1}`;
        const newKeys = `${this.baseDir}/keys.json.bak.${i + 1}`;

        if (await Bun.file(oldCreds).exists()) await Bun.write(newCreds, Bun.file(oldCreds));
        if (await Bun.file(oldKeys).exists()) await Bun.write(newKeys, Bun.file(oldKeys));
      }

      if (await Bun.file(this.credsPath()).exists()) {
        await Bun.write(`${this.baseDir}/creds.json.bak.1`, Bun.file(this.credsPath()));
        await Bun.write(`${this.baseDir}/keys.json.bak.1`, Bun.file(this.keysPath()));
      }
    } catch (err) {
      this.logger.warn('Backup failed', { error: String(err) });
    }
  }

  private async restoreFromBackup(): Promise<void> {
    for (let i = 1; i <= BACKUP_COUNT; i++) {
      const credsBak = `${this.baseDir}/creds.json.bak.${i}`;
      const keysBak = `${this.baseDir}/keys.json.bak.${i}`;

      if (await Bun.file(credsBak).exists() && await Bun.file(keysBak).exists()) {
        await Bun.write(this.credsPath(), Bun.file(credsBak));
        await Bun.write(this.keysPath(), Bun.file(keysBak));
        this.logger.info('Session restored from backup', { backup: i });
        return;
      }
    }
    this.logger.warn('No backup available to restore');
  }
}
