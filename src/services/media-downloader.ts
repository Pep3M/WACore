import { downloadMediaMessage } from 'baileys/lib/Utils/messages';
import { extensionForMediaMessage } from 'baileys/lib/Utils/messages-media';
import type { WAMessage } from 'baileys';
import type { Logger } from '../utils/logger';
import type { EventBus } from '../core/event-bus';
import type { MediaStore, MediaDownloadResult, NormalizedMessage } from '../types';

export interface MediaDownloader {
  download(raw: WAMessage): Promise<MediaDownloadResult | null>;
  downloadNormalized(msg: NormalizedMessage, raw: any): Promise<MediaDownloadResult | null>;
  getPath(mediaId: string): string | null;
  start(): void;
  stop(): void;
}

export function createMediaDownloader(
  mediaStore: MediaStore,
  eventBus: EventBus,
  logger: Logger,
  autoDownload: boolean,
  baseUrl: string,
): MediaDownloader {
  const downloadedIds = new Set<string>();

  function generateMediaId(raw: any): string {
    return raw?.key?.id ?? `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function extensionFromRaw(raw: any): string {
    if (raw?.message?.imageMessage) return 'jpg';
    if (raw?.message?.videoMessage) return 'mp4';
    if (raw?.message?.audioMessage) return 'ogg';
    // Los stickers de WhatsApp son siempre WebP. Se dice aquí en vez de dejarlo al camino de
    // reserva, que ante cualquier fallo devuelve 'bin' y dejaría el fichero sin poder pintarse.
    if (raw?.message?.stickerMessage) return 'webp';
    if (raw?.message?.documentMessage) {
      const fileName = raw.message.documentMessage.fileName ?? '';
      const ext = fileName.split('.').pop()?.toLowerCase();
      return ext || 'bin';
    }
    try {
      return extensionForMediaMessage(raw.message) || 'bin';
    } catch {
      return 'bin';
    }
  }

  function isMediaMessage(raw: any): boolean {
    if (!raw?.message) return false;
    return !!(
      raw.message.imageMessage ||
      raw.message.videoMessage ||
      raw.message.audioMessage ||
      raw.message.documentMessage ||
      // El sticker también es un adjunto que hay que descargar. Faltaba, y mientras los stickers
      // no salían del proceso no se notaba; en cuanto se publican, quien los reciba pediría un
      // `mediaId` que aquí nunca se guardó y obtendría un 404.
      raw.message.stickerMessage
    );
  }

  async function download(raw: WAMessage, messageId?: string): Promise<MediaDownloadResult | null> {
    try {
      if (!isMediaMessage(raw as any)) return null;

      const mediaId = generateMediaId(raw);
      if (downloadedIds.has(mediaId)) return null;

      if (mediaStore.exists(mediaId)) {
        const path = mediaStore.getPath(mediaId);
        if (path) {
          downloadedIds.add(mediaId);
          eventBus.emit('media.downloaded', {
            mediaId,
            filePath: path,
            extension: extensionFromRaw(raw),
            size: 0,
            messageId,
          });
          return {
            mediaId,
            filePath: path,
            extension: extensionFromRaw(raw),
            size: 0,
            messageId,
          };
        }
      }

      const extension = extensionFromRaw(raw);
      const buffer = await downloadMediaMessage(raw, 'buffer', {}, {
        logger: logger as any,
        reuploadRequest: async () => raw,
      });

      const filePath = await mediaStore.save(mediaId, buffer, extension);

      downloadedIds.add(mediaId);

      logger.info('Media downloaded', { mediaId, extension, size: buffer.length });

      eventBus.emit('media.downloaded', {
        mediaId,
        filePath,
        extension,
        size: buffer.length,
        messageId,
      });

      return {
        mediaId,
        filePath,
        extension,
        size: buffer.length,
        messageId,
      };
    } catch (err) {
      logger.error('Failed to download media', { error: String(err) });
      return null;
    }
  }

  return {
    async download(raw) {
      return download(raw);
    },

    async downloadNormalized(msg, raw) {
      return download(raw);
    },

    getPath(mediaId) {
      return mediaStore.getPath(mediaId);
    },

    start() {
      if (!autoDownload) {
        logger.info('Media auto-download disabled');
        return;
      }

      eventBus.on('message', (raw: any) => {
        if (!isMediaMessage(raw)) return;
        const messageId = raw?.key?.id;
        download(raw, messageId).catch(err => {
          logger.error('Auto-download failed', { error: String(err) });
        });
      });

      logger.info('Media downloader started', { autoDownload });
    },

    stop() {
      downloadedIds.clear();
      logger.info('Media downloader stopped');
    },
  };
}
