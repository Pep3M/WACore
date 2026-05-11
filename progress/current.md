# Sesión actual

- **Feature en curso:** RF-08: Read Receipts
- **Fase:** implementing → **done**
- **Inicio:** 2026-05-10
- **Agente:** @developer

## Bitácora

### Implementación RF-06 (2026-05-10)

**Archivos creados:**
- `src/services/presence-manager.ts` — PresenceManager service
- `src/__tests__/presence-manager.test.ts` — 21 tests

**Archivos modificados:**
- `src/types/index.ts` — +PresenceType, +SendPresenceRequest, +autoTyping, +typingDurationMs en EnvConfig
- `src/config.ts` — +autoTyping, +typingDurationMs
- `.env.example` — +AUTO_TYPING, +TYPING_DURATION_MS
- `src/baileys/client.ts` — +sendPresenceUpdate en BaileysClient interface e impl
- `src/transport/rest-api.ts` — +sendPresence param, +POST /api/presence endpoint
- `src/index.ts` — wiring de PresenceManager, auto-typing hook en command registry, shutdown

### Implementación RF-07 (2026-05-10)

**Archivos creados:**
- `src/storage/media-store.ts` — DiskMediaStore: persistencia de archivos en disco con índice JSON
- `src/services/media-downloader.ts` — MediaDownloader: wrap de `downloadMediaMessage` de baileys, auto-download, emisión de eventos
- `src/__tests__/media-store.test.ts` — 11 tests (save, getPath, exists, remove, getInfo, getAllIds, persistencia, MIME types)
- `src/__tests__/media-downloader.test.ts` — 7 tests (non-media skip, download fail, dedup, start/stop, auto-download off/on, event emission)

**Archivos modificados:**
- `src/types/index.ts` — +MediaStore interface, +MediaDownloadResult + media fields en EnvConfig (mediaDir, mediaAutoDownload, mediaBaseUrl), +MediaDownloadedEvent, +mediaId/downloaded/url en MediaInfo, +'media.downloaded' en WACoreEventMap
- `src/config.ts` — +mediaDir, +mediaAutoDownload, +mediaBaseUrl
- `.env.example` — +MEDIA_DIR, +MEDIA_AUTO_DOWNLOAD, +MEDIA_BASE_URL
- `src/transport/rest-api.ts` — +mediaStore param, +GET /api/media/:id, +GET /api/media endpoints
- `src/transport/webhook-dispatcher.ts` — +suscripción a 'media.downloaded' event
- `src/core/message-router.ts` — +mediaId, +downloaded flag en extractMedia
- `src/index.ts` — wiring de DiskMediaStore, MediaDownloader, auto-download start, shutdown
- 16 archivos de test actualizados con los 3 nuevos campos de config

**Tests:** 229 pass, 5 fail (pre-existing)
**TypeScript:** 0 errores en src/

### Implementación RF-08 (2026-05-10)

**Archivos creados:**
- `src/services/read-receipt-manager.ts` — ReadReceiptManager service con sendReadReceipt, start, stop
- `src/__tests__/read-receipt-manager.test.ts` — 18 tests

**Archivos modificados:**
- `src/types/index.ts` — +autoRead en EnvConfig, +ReadReceiptRequest interface
- `src/config.ts` — +autoRead (AUTO_READ env var, default false)
- `.env.example` — +AUTO_READ con documentación
- `src/baileys/client.ts` — +readMessages en BaileysClient interface e impl
- `src/transport/rest-api.ts` — +sendReadReceipt param, +POST /api/read endpoint
- `src/index.ts` — wiring de ReadReceiptManager, callback en REST API, start/stop/shutdown
- 19 archivos de test actualizados con autoRead: false en mockConfig

**Tests:** 264 total (18 nuevos + 11 pre-existing fails sin cambios)
**TypeScript:** 0 errores (build compila limpio)

### Fixes RF-06 Presence & Typing (2026-05-10)

**Problemas detectados y corregidos:**
- Composing/recording requerían reset con `paused` para cambiar entre tipos → eliminado (ambos usan `tag: composing`, solo cambia `media` attr)
- `setPresence` con `duration` no refrescaba la presencia → WhatsApp auto-expiraba el indicador antes del duration → ahora usa refresh interval (cada `TYPING_DURATION_MS`)
- Normalización inconsistente de JIDs en `typingTimers`
- Logging en `debug` no visible con config default → cambiado a `info`

**Archivos modificados:**
- `src/services/presence-manager.ts` — refactor completo con `startPresenceRefresh`/`stopPresenceRefresh`/`clearPresenceRefresh`, duración con refresh y auto-pause
- `src/types/index.ts` — +duration opcional en SendPresenceRequest
- `src/transport/rest-api.ts` — +duration en handler y sendPresence signature
- `src/index.ts` — +duration en wire-up
- `src/__tests__/presence-manager.test.ts` — +6 tests para duration y refresh
- 16 test files — +readMessages en mock clients (type fix)

## Resumen de sesión

| Feature | Estado |
|---------|--------|
| RF-06 Presence & Typing | ✅ **done** |
| RF-07 Media Download | ✅ **done** |
| RF-08 Read Receipts | ✅ **done** |
| RF-09 Reactions | backlog |
| RF-10 Quoted Messages | backlog |
| RF-11 Group Management | backlog |
| RF-12 Stickers/PTV | backlog |
| RF-13 Location/Contact | backlog |
| RF-14 Polls | backlog |
| RF-15 Chat Management | backlog |
| RF-16 Comandos avanzados | backlog |
| RF-17 Newsletter | backlog |
| RF-18 Business Profile | backlog |
