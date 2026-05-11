import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Logger } from '../utils/logger';
import type { MediaStore, MediaInfo } from '../types';

const INDEX_FILE = '_index.json';

interface MediaIndex {
  [mediaId: string]: {
    filename: string;
    extension: string;
    mimetype: string;
    size: number;
    downloadedAt: number;
  };
}

export class DiskMediaStore implements MediaStore {
  private dir: string;
  private index: MediaIndex = {};
  private indexPath: string;
  private logger: Logger;

  constructor(mediaDir: string, logger: Logger) {
    this.dir = mediaDir;
    this.logger = logger;
    this.indexPath = join(this.dir, INDEX_FILE);
    this.ensureDir();
    this.loadIndex();
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
      this.logger.info('Media directory created', { dir: this.dir });
    }
  }

  private loadIndex(): void {
    try {
      if (existsSync(this.indexPath)) {
        const raw = readFileSync(this.indexPath, 'utf-8');
        this.index = JSON.parse(raw);
      }
    } catch (err) {
      this.logger.warn('Failed to load media index, starting fresh', { error: String(err) });
      this.index = {};
    }
  }

  private saveIndex(): void {
    try {
      writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2), 'utf-8');
    } catch (err) {
      this.logger.error('Failed to save media index', { error: String(err) });
    }
  }

  async save(mediaId: string, buffer: Buffer, extension: string): Promise<string> {
    this.ensureDir();
    const filePath = join(this.dir, `${mediaId}.${extension}`);
    writeFileSync(filePath, buffer);
    this.index[mediaId] = {
      filename: `${mediaId}.${extension}`,
      extension,
      mimetype: this.mimeFromExtension(extension),
      size: buffer.length,
      downloadedAt: Date.now(),
    };
    this.saveIndex();
    this.logger.debug('Media saved', { mediaId, extension, size: buffer.length });
    return filePath;
  }

  getPath(mediaId: string): string | null {
    const entry = this.index[mediaId];
    if (!entry) return null;
    return join(this.dir, entry.filename);
  }

  exists(mediaId: string): boolean {
    return mediaId in this.index;
  }

  async remove(mediaId: string): Promise<void> {
    const entry = this.index[mediaId];
    if (entry) {
      const filePath = join(this.dir, entry.filename);
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch (err) {
        this.logger.warn('Failed to remove media file', { mediaId, error: String(err) });
      }
      delete this.index[mediaId];
      this.saveIndex();
    }
  }

  getInfo(mediaId: string): (MediaInfo & { downloadedAt: number }) | null {
    const entry = this.index[mediaId];
    if (!entry) return null;
    return {
      mimetype: entry.mimetype,
      filename: entry.filename,
      size: entry.size,
      downloadedAt: entry.downloadedAt,
    };
  }

  getAllIds(): string[] {
    return Object.keys(this.index);
  }

  private mimeFromExtension(ext: string): string {
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      mp4: 'video/mp4',
      mkv: 'video/x-matroska',
      ogg: 'audio/ogg',
      mp3: 'audio/mpeg',
      m4a: 'audio/mp4',
      aac: 'audio/aac',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    return map[ext.toLowerCase()] || 'application/octet-stream';
  }
}
