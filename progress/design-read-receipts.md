# Diseño de Arquitectura — RF-08: Read Receipts (Confirmaciones de lectura)

> **Versión:** 1.0
> **Fecha:** 2026-05-10
> **Estado:** Aprobado para implementación
> **Autor:** @software-architect
> **RF relacionados:** RF-08.1, RF-08.2, RF-08.3

---

## 1. Resumen

WACore debe poder enviar confirmaciones de lectura (read receipts) a WhatsApp, lo que provoca que el remitente vea el doble check azul. Esto se implementa mediante el método `readMessages()` de baileys, que envía un receipt `read` al protocolo.

La solución consta de tres piezas:

1. **ReadReceiptManager** — Servicio que encapsula la lógica de envío de read receipts, con soporte para chats individuales y grupales (vía `participant` key). Expone `sendReadReceipt()` para uso programático.
2. **POST /api/read** — Nuevo endpoint REST que permite a sistemas externos marcar mensajes como leídos.
3. **Auto-read configurable** — Si `AUTO_READ=true`, el ReadReceiptManager se suscribe al event bus para marcar automáticamente como leído todo mensaje entrante.

El diseño sigue los patrones existentes: factory con dependencias inyectadas, interface tipada, y callback para la REST API.

### 1.1 Archivos a crear/modificar

| Archivo | RF | Propósito |
|---|---|---|
| `src/services/read-receipt-manager.ts` | RF-08.1, RF-08.3 | Nuevo servicio ReadReceiptManager |
| `src/baileys/client.ts` | RF-08.1 | Añadir `readMessages()` al cliente Baileys |
| `src/transport/rest-api.ts` | RF-08.2 | Añadir `POST /api/read` endpoint |
| `src/types/index.ts` | RF-08.2 | Añadir `ReadReceiptRequest`, `autoRead` en `EnvConfig` |
| `src/config.ts` | RF-08.3 | Leer `AUTO_READ` de entorno |
| `src/index.ts` | RF-08.1, RF-08.3 | Wiring del ReadReceiptManager |
| `.env.example` | RF-08.3 | Documentar `AUTO_READ` |
| `src/__tests__/read-receipt-manager.test.ts` | RF-08.1, RF-08.3 | Tests unitarios |

---

## 2. Diseño detallado

### 2.1 Tipos nuevos y modificados (`src/types/index.ts`)

#### 2.1.1 `EnvConfig` — Nuevo campo

```typescript
export interface EnvConfig {
  // ... existentes ...
  autoTyping: boolean;
  typingDurationMs: number;
  autoRead: boolean;                    // ← NUEVO
  mediaDir: string;
  // ...
}
```

#### 2.1.2 `ReadReceiptRequest` — Nueva interfaz

```typescript
export interface ReadReceiptRequest {
  to: string;                          // JID o número del chat
  messageId?: string;                  // Alternativa singular (legacy-friendly)
  messageIds?: string[];               // Alternativa plural
  participant?: string;                // Solo para grupos: JID del participante
}
```

**Reglas de validación:**
- `to` obligatorio
- Al menos uno de `messageId` o `messageIds` debe estar presente
- Si se proporcionan ambos, `messageIds` tiene prioridad

---

### 2.2 Cliente Baileys — Nuevo método (`src/baileys/client.ts`)

#### 2.2.1 Interfaz `BaileysClient`

```typescript
export interface BaileysClient {
  // ... existentes ...
  readMessages(keys: Array<{
    remoteJid: string;
    id: string;
    fromMe?: boolean;
    participant?: string;
  }>): Promise<void>;                  // ← NUEVO
}
```

#### 2.2.2 Implementación

```typescript
// En el return del factory createBaileysClient():
async readMessages(keys) {
  if (!socket) throw new Error('Socket not initialized');
  await socket.readMessages(keys);
}
```

**Nota:** `socket.readMessages()` es un método nativo de `WASocket` en baileys. Acepta un array de `WAMessageKey`. No requiere el parámetro `type` porque `readMessages` siempre envía receipts de tipo `read`.

---

### 2.3 ReadReceiptManager — Nuevo servicio (`src/services/read-receipt-manager.ts`)

#### 2.3.1 Interfaz

```typescript
export interface ReadReceiptManager {
  sendReadReceipt(to: string, messageIds: string[], participant?: string): Promise<void>;
  start(): void;
  stop(): void;
}
```

#### 2.3.2 Factory

```typescript
export function createReadReceiptManager(
  client: BaileysClient,
  eventBus: EventBus,
  config: EnvConfig,
  logger: Logger,
): ReadReceiptManager
```

#### 2.3.3 `sendReadReceipt()`

```typescript
async sendReadReceipt(to: string, messageIds: string[], participant?: string): Promise<void> {
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  const keys = messageIds.map(id => {
    const key: { remoteJid: string; id: string; fromMe: boolean; participant?: string } = {
      remoteJid: jid,
      id,
      fromMe: false,
    };
    if (participant) {
      key.participant = participant.includes('@') ? participant : `${participant}@s.whatsapp.net`;
    }
    return key;
  });
  await client.readMessages(keys);
}
```

**Reglas:**
- Normaliza JIDs que no tengan sufijo `@s.whatsapp.net`
- Para grupos (`@g.us`), el `participant` es obligatorio para que el receipt se asocie al mensaje correcto
- `fromMe: false` porque estamos confirmando mensajes recibidos, no enviados

#### 2.3.4 `start()` — Auto-read

```typescript
start() {
  if (!config.autoRead) {
    logger.info('Auto-read disabled');
    return;
  }

  this._unsubscribe = eventBus.on('message', (raw: any) => {
    const jid = raw?.key?.remoteJid;
    const id = raw?.key?.id;
    if (!jid || !id) return;

    const participant = raw?.key?.participant;

    this.sendReadReceipt(jid, [id], participant).catch(err => {
      logger.warn('Auto-read failed', { jid, id, error: String(err) });
    });
  });

  logger.info('Auto-read enabled');
}
```

#### 2.3.5 `stop()`

```typescript
stop() {
  this._unsubscribe?.();
  this._unsubscribe = null;
  logger.info('Read receipt manager stopped');
}
```

**Diseño de auto-read:**
- Se suscribe al evento `message` del bus (el evento raw emitido por `client.ts` **antes** de la normalización del message-router)
- Esto garantiza acceso a `key.remoteJid`, `key.id`, y `key.participant` originales
- `client.ts` ya filtra `key.fromMe` antes de emitir `message`, por lo que solo se marcan como leídos mensajes entrantes
- Las promesas se manejan en fire-and-forget con `.catch()` — no bloquean el event loop
- No interfiere con auto-typing porque los eventos `message` y `message.text` son independientes

---

### 2.4 REST API — Nuevo endpoint (`src/transport/rest-api.ts`)

#### 2.4.1 Nuevo parámetro en `createRestApi`

```typescript
export function createRestApi(
  port: number,
  config: EnvConfig,
  logger: Logger,
  sendMessage: (to: string, text: string) => Promise<string>,
  sendMedia: (req: SendMediaRequest) => Promise<string>,
  getConnectionStatus: () => string,
  getQr: () => string | null,
  logout: () => Promise<void>,
  getContacts: () => Array<{ phone: string; name: string }>,
  connect: () => Promise<void>,
  sendPresence?: (to: string, type: string) => Promise<void>,
  incomingHub?: IncomingMessageHub,
  sseTransport?: SSETransport,
  mediaStore?: MediaStore,
  sendReadReceipt?: (to: string, participant: string | undefined, messageIds: string[]) => Promise<void>,  // ← NUEVO
): RestApi
```

Posición: después de `mediaStore`, como último parámetro opcional.

#### 2.4.2 Endpoint `POST /api/read`

```typescript
app.post('/api/read', async (req: Request, res: Response) => {
  if (!sendReadReceipt) {
    res.status(404).json({ success: false, error: 'Read receipts not available' });
    return;
  }
  const { to, messageId, messageIds, participant } = req.body as ReadReceiptRequest;
  if (!to) {
    res.status(400).json({ success: false, error: 'Missing required field: to' });
    return;
  }
  const ids = messageIds ?? (messageId ? [messageId] : null);
  if (!ids || ids.length === 0) {
    res.status(400).json({ success: false, error: 'Missing required field: messageId or messageIds' });
    return;
  }
  try {
    await sendReadReceipt(to, participant, ids);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});
```

---

### 2.5 Configuración (`src/config.ts`)

Añadir al return de `loadConfig()`:

```typescript
autoRead: process.env.AUTO_READ === 'true',
```

**Default:** `false`. Solo se activa si se establece explícitamente `AUTO_READ=true`.

---

### 2.6 Wiring (`src/index.ts`)

```typescript
// Importación
import { createReadReceiptManager } from './services/read-receipt-manager';

// Creación (después de presenceManager, antes de healthMonitor)
const readReceiptManager = createReadReceiptManager(client, eventBus, config, logger);

// REST API — añadir callback
const restApi = createRestApi(
  config.apiPort, config, logger,
  (to, text) => messageSender.sendText(to, text),
  (req) => messageSender.sendMedia(req),
  () => client.getConnectionStatus(),
  () => client.getQr(),
  () => client.logout(),
  () => client.getContacts(),
  () => client.connect(),
  (to, type) => presenceManager.setPresence(to, type as any),
  incomingHub,
  sseTransport,
  mediaStore,
  (to, participant, ids) => readReceiptManager.sendReadReceipt(to, ids, participant),  // ← NUEVO
);

// Start
readReceiptManager.start();

// Shutdown
const shutdown = async (signal: string) => {
  logger.info('Shutdown signal received', { signal });
  commandRegistry.stop();
  presenceManager.stop();
  readReceiptManager.stop();          // ← NUEVO
  mediaDownloader.stop();
  // ...
};
```

---

## 3. Flujo completo

### 3.1 API REST

```
Cliente HTTP → POST /api/read { to, messageId, participant? }
  → rest-api.ts: valida API key, valida body
    → sendReadReceipt callback → ReadReceiptManager.sendReadReceipt()
      → normaliza JIDs, construye WAMessageKey[]
        → BaileysClient.readMessages(keys)
          → socket.readMessages(keys)
            → WhatsApp recibe receipt "read"
              → Remitente ve doble check azul ✓✓
```

### 3.2 Auto-read

```
Mensaje entrante → Baileys socket → sock.ev.on('messages.upsert')
  → client.ts: emite eventBus.emit('message', raw)
    → [paralelo] message-router: normaliza y emite message.text/image/etc.
    → [paralelo] ReadReceiptManager (si autoRead=true): extrae key, llama sendReadReceipt()
      → WhatsApp recibe receipt "read"
        → Remitente ve doble check azul ✓✓
```

**Nota:** La emisión del receipt ocurre en paralelo con la normalización del mensaje. No hay bloqueo ni interferencia entre ambos flujos.

---

## 4. Edge Cases & Riesgos

| Edge Case | Handling |
|---|---|
| Socket no inicializado | `BaileysClient.readMessages()` lanza `Error('Socket not initialized')`. ReadReceiptManager lo captura en el `.catch()` del auto-read, y el endpoint REST devuelve 500. |
| JID sin sufijo | `normalizeJid()` añade `@s.whatsapp.net`. Si el JID ya incluye sufijo (ej. `@g.us`), se respeta. |
| Mensaje de grupo sin `participant` | El receipt se envía de todas formas. WhatsApp lo asocia al chat pero puede no marcar el mensaje individual correctamente. Es un best-effort. El campo `participant` es opcional en la API. |
| `messageId` vs `messageIds` — ambos ausentes | La API REST devuelve 400 con mensaje de error claro. |
| `messageId` y `messageIds` ambos presentes | `messageIds` tiene prioridad (más explícito). |
| Auto-read + auto-typing simultáneos | No hay conflicto: auto-typing se dispara al responder (flujo command-registry → presencia), auto-read al recibir (flujo event-bus). Son eventos distintos en el bus. |
| Ráfaga de mensajes entrantes | Cada mensaje dispara un `sendReadReceipt()` independiente. Baileys maneja el rate-limiting en el socket. Las promesas se descartan silenciosamente con `.catch()`. |
| `AUTO_READ` no definido | `false` por defecto. No hay auto-read. |
| API REST sin `API_KEY` | La API REST entera se deshabilita (comportamiento existente). El auto-read sigue funcionando independientemente si está configurado. |

---

## 5. Plan de implementación

| Orden | Tarea | Archivo(s) | Tiempo est. |
|---|---|---|---|
| 1 | Añadir `ReadReceiptRequest` y `autoRead` a tipos | `src/types/index.ts` | 5 min |
| 2 | Leer `AUTO_READ` en config | `src/config.ts` | 2 min |
| 3 | Añadir `readMessages()` a BaileysClient | `src/baileys/client.ts` | 10 min |
| 4 | Crear `ReadReceiptManager` service | `src/services/read-receipt-manager.ts` | 20 min |
| 5 | Añadir `POST /api/read` endpoint | `src/transport/rest-api.ts` | 15 min |
| 6 | Wire todo en `index.ts` | `src/index.ts` | 10 min |
| 7 | Documentar `AUTO_READ` en `.env.example` | `.env.example` | 2 min |
| 8 | Escribir tests unitarios | `src/__tests__/read-receipt-manager.test.ts` | 25 min |
| 9 | Actualizar tests existentes con nuevo campo config | 16 archivos de test | 10 min |
| 10 | Verificar: `bun test` y `bun run src/index.ts` compila | — | 5 min |

**Total estimado:** ~104 min (~1h 45min)

---

## 6. Criterios de aceptación

- [ ] `POST /api/read` con `{ to, messageId }` devuelve `{ success: true }`
- [ ] `POST /api/read` con `{ to, messageIds[] }` devuelve `{ success: true }`
- [ ] `POST /api/read` con `{ to, messageIds[], participant }` para grupos devuelve `{ success: true }`
- [ ] `POST /api/read` sin `to` devuelve 400
- [ ] `POST /api/read` sin `messageId` ni `messageIds` devuelve 400
- [ ] Cuando `AUTO_READ=true`, cada mensaje entrante dispara un read receipt
- [ ] Cuando `AUTO_READ=false` (default), no se envían read receipts automáticos
- [ ] El endpoint devuelve 404 si `sendReadReceipt` no está disponible
- [ ] No interfiere con auto-typing (RF-06) — ambos pueden estar activos simultáneamente
- [ ] Socket no inicializado → error manejado sin crash
- [ ] Tests pasan: `bun test`
- [ ] TypeScript compila sin errores: `bun run src/index.ts` (type-check)

---

> **Próximo paso:** @developer implementa según este diseño. Orden de archivos: types → config → client → read-receipt-manager → rest-api → index → .env.example → tests.
