# Implementación — RF-07: Recepción y descarga de medios

> **Feature:** RF-07 — Recepción y descarga de medios
> **Responsable:** @developer
> **Estado:** done
> **Inicio:** 2026-05-10

## Archivos creados

| Archivo | Propósito |
|---------|-----------|
| `src/storage/media-store.ts` | DiskMediaStore — persistencia de archivos en disco con índice JSON |
| `src/services/media-downloader.ts` | MediaDownloader — wrap de `downloadMediaMessage` de baileys |
| `src/__tests__/media-store.test.ts` | 11 tests para DiskMediaStore |
| `src/__tests__/media-downloader.test.ts` | 7 tests para MediaDownloader |

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `src/types/index.ts` | +MediaStore interface, +MediaDownloadResult, +media fields en EnvConfig, +MediaDownloadedEvent, +mediaId/downloaded/url en MediaInfo, +'media.downloaded' event |
| `src/config.ts` | +mediaDir, +mediaAutoDownload, +mediaBaseUrl |
| `.env.example` | +MEDIA_DIR, +MEDIA_AUTO_DOWNLOAD, +MEDIA_BASE_URL |
| `src/transport/rest-api.ts` | +mediaStore param, +GET /api/media/:id, +GET /api/media |
| `src/transport/webhook-dispatcher.ts` | +suscripción a 'media.downloaded' |
| `src/core/message-router.ts` | +mediaId, +downloaded flag en extractMedia |
| `src/index.ts` | +DiskMediaStore, +MediaDownloader wiring, auto-download start/stop |
| 16 test files | +mediaDir, mediaAutoDownload, mediaBaseUrl en mockConfig |

## Detalles técnicos

### DiskMediaStore
- Archivos en `mediaDir/<mediaId>.<ext>`
- Índice `_index.json` con metadata por mediaId
- Mapeo de extensiones a MIME types

### MediaDownloader
- `download(raw)` → `downloadMediaMessage` + `mediaStore.save()`
- Auto-download: escucha `message` event, descarga medios entrantes
- Dedup por mediaId
- Emite `media.downloaded` event

### API
- `GET /api/media/:id` → serve file estático
- `GET /api/media` → lista todos los media disponibles

### Eventos
- `media.downloaded` → webhook cuando se completa la descarga

## Resultados

| Métrica | Valor |
|---------|-------|
| Tests nuevos | 18 pass, 0 fail |
| Tests totales | 229 pass, 5 fail (pre-existing) |
| TypeScript errors | 0 en src/ |
