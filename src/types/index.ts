// Tipos compartidos del dominio WACore

export type { Contact, ContactPublic, ListContactsOpts, ListContactsResult, UpsertContact } from './contact';

// ─── Configuración ────────────────────────────────────────────

export interface MediaStore {
  save(mediaId: string, buffer: Buffer, extension: string): Promise<string>;
  getPath(mediaId: string): string | null;
  exists(mediaId: string): boolean;
  remove(mediaId: string): Promise<void>;
  getInfo(mediaId: string): (MediaInfo & { downloadedAt: number }) | null;
  getAllIds(): string[];
}

export interface MediaDownloadResult {
  mediaId: string;
  filePath: string;
  extension: string;
  size: number;
  messageId?: string;
}

export interface EnvConfig {
  instanceName: string;
  maxSessions?: number;
  healthPort: number;
  apiPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  logFormat?: 'json' | 'pretty';
  sessionStore: 'file' | 'redis' | 'postgres';
  sessionDir: string;
  databaseUrl?: string;
  /**
   * Conexiones simultáneas del pool de Postgres.
   *
   * Estuvo fijo en 3, y ese número era el que convertía un tropiezo en una avería general: una
   * sola conexión atascada se llevaba un tercio del pool para siempre, y con dos ya no quedaba
   * sitio para nadie. Ver {@link createConnection}.
   */
  dbPoolMax?: number;
  /** Milisegundos tras los que Postgres aborta una consulta. `0` lo desactiva. */
  dbStatementTimeoutMs?: number;
  /** Milisegundos tras los que Postgres cierra una transacción abierta y ociosa. `0` lo desactiva. */
  dbIdleTxTimeoutMs?: number;
  /** Cada cuánto mira el vigilante del pool. `0` lo apaga. */
  dbWatchdogIntervalMs?: number;
  /** Edad a partir de la cual el vigilante da por muerta una transacción y termina su backend. */
  dbWatchdogMaxAgeMs?: number;
  /**
   * Plazo de cliente para las llamadas al registro de sesiones.
   *
   * Hace falta **además** de los plazos de Postgres: el bloqueo que tumbó los QR dejaba a la base
   * esperando un mensaje del cliente (`wait_event = ClientRead`), y ahí el enunciado ya había
   * terminado, así que ningún plazo del servidor llegaba a dispararse.
   */
  registryTimeoutMs?: number;
  redisUrl?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookEvents: string[];
  webhookRetryCount: number;
  webhookRetryDelay: number;
  apiKey?: string;
  connectOnStartup: boolean;
  legacySessionEnabled?: boolean;
  qrTimeout: number;
  /**
   * Rondas de código QR que aguanta una sesión **sin emparejar** antes de rendirse.
   *
   * Solo aplica a sesiones sin credenciales. Una con credenciales reintenta siempre, porque
   * rendirse ahí es lo que dejó una línea pidiendo QR tras un corte de DNS de tres minutos.
   */
  qrMaxRounds?: number;
  nodeEnv: string;
  pollingEnabled: boolean;
  sseEnabled: boolean;
  messageBufferSize: number;
  messageBufferTtlMs: number;
  forwardCacheMax?: number;
  forwardCacheTtlMs?: number;
  /**
   * Publicar también los mensajes que salen de la línea.
   *
   * Apagado por omisión: el consumidor tiene que saber distinguir el eco de lo que él
   * mismo envió antes de recibirlo, o se duplicarían las conversaciones.
   */
  publishFromMe?: boolean;
  /** Permite enviar botones y listas nativas. Ver la nota de `config.ts`: no es gratis. */
  interactiveMessages?: boolean;
  /** Cuelga solo las llamadas entrantes. El registro se guarda igual. */
  autoRejectCalls?: boolean;
  sentRegistryMax?: number;
  sentRegistryTtlMs?: number;
  sseHeartbeatMs: number;
  autoTyping: boolean;
  typingDurationMs: number;
  autoRead: boolean;
  mediaDir: string;
  mediaAutoDownload: boolean;
  mediaBaseUrl: string;
  /**
   * Volcar el histórico al emparejar una línea.
   *
   * Sin esto la bandeja nace vacía: WhatsApp entrega meses de conversaciones al vincular y
   * hasta ahora se tiraban enteras, quedándose solo con los contactos.
   */
  historySyncEnabled?: boolean;
  historyMax?: number;
  historyBatchSize?: number;
  historyBatchDelayMs?: number;
}

// ─── Eventos del bus interno ──────────────────────────────────

export interface ConnectionUpdateEvent {
  status: 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
  previous?: string;
  phoneNumber?: string;
  reason?: string;
  statusCode?: number;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
}

export interface QREvent {
  qr: string;
  timeout: number;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
}

export interface CredsUpdateEvent {
  registered: boolean;
  phoneNumber?: string;
}

export interface NormalizedMessage {
  id: string;
  from: string;
  phone: string;
  pushName: string;
  isGroup: boolean;
  groupId: string | null;
  timestamp: number;
  type: MessageType;
  body: string | null;
  quotedMessage: QuotedMessage | null;
  media: MediaInfo | null;
  extras?: Record<string, unknown>;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
  /** Sale de la propia línea: lo escribió el consumidor o alguien desde el móvil. */
  fromMe?: boolean;
  /** Solo en los mensajes propios: quién lo escribió. Ver {@link MessageOrigin}. */
  origin?: MessageOrigin;
  /** Solo en los mensajes propios: acuse que ya traía WhatsApp (0-5). */
  ack?: number;
  /**
   * Es la edición de un mensaje anterior.
   *
   * Cuando viene a `true`, `id` es el del **mensaje original** y `body` su texto nuevo, de
   * modo que el consumidor reescriba esa burbuja en lugar de añadir una segunda.
   */
  isEdit?: boolean;
}

/**
 * De dónde salió un mensaje propio.
 *
 * `api` lo envió el consumidor por esta misma API, así que ya lo tiene guardado y su eco solo
 * confirmaría lo que ya sabe. `device` lo escribió una persona desde el móvil o desde
 * WhatsApp Web, y es la única copia que existe.
 */
export type MessageOrigin = 'api' | 'device';

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'audio'
  | 'ptt'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  // Comercio y calendario. Ninguno es «un mensaje» en el sentido corriente: son tarjetas con
  // datos estructurados, y lo que vale de ellas está en `extras`, no en `body`.
  | 'order'
  | 'product'
  | 'event'
  | 'event_response'
  | 'unknown';

export interface QuotedMessage {
  id: string;
  from: string;
  body: string;
  type: MessageType;
}

export interface MediaInfo {
  mimetype: string;
  filename?: string;
  caption?: string;
  size?: number;
  mediaId?: string;
  downloaded?: boolean;
  url?: string;
}

export interface AuthStateChangeEvent {
  action: 'saved' | 'loaded' | 'deleted' | 'corrupted';
  instanceName: string;
}

export interface LoggedOutEvent {
  reason: string;
  willReconnect: boolean;
}

export interface CircuitOpenEvent {
  target: string;
  failuresCount: number;
  willResetAfter: number;
}

export interface ErrorEvent {
  source: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

// ─── Mapa de eventos para el bus ──────────────────────────────

export interface MediaDownloadedEvent {
  mediaId: string;
  filePath: string;
  extension: string;
  size: number;
  messageId?: string;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
}

/**
 * Una llamada de WhatsApp.
 *
 * El consumidor no atiende llamadas, pero que no quede rastro de ellas en la conversación es una
 * pérdida real: el agente ve un hueco donde el cliente intentó hablar con él.
 *
 * `status` recorre la vida de la llamada (`offer` al sonar, y luego `accept`, `reject`,
 * `timeout` o `terminate`), así que del mismo `id` llegan varios eventos. El consumidor debe
 * tratarlos como **actualizaciones de un mismo registro**, no como llamadas distintas.
 */
export interface CallEvent {
  /** Identificador de la llamada. Se repite en todos los eventos de esa llamada. */
  id: string;
  /** La conversación a la que pertenece. */
  chatId: string;
  from: string;
  isGroup: boolean;
  isVideo: boolean;
  status: string;
  /** Segundos desde epoch, como el resto de eventos. */
  timestamp: number;
  /** Llegó al reconectar, no en vivo. */
  offline: boolean;
  /** La rechazamos nosotros por configuración, no una persona. */
  autoRejected?: boolean;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
}

export interface WACoreEventMap {
  'connection.update': ConnectionUpdateEvent;
  'qr': QREvent;
  'creds.update': CredsUpdateEvent;
  'message': NormalizedMessage;
  'message.text': NormalizedMessage;
  'message.image': NormalizedMessage;
  'message.video': NormalizedMessage;
  'message.document': NormalizedMessage;
  'message.audio': NormalizedMessage;
  'message.ptt': NormalizedMessage;
  'message.sticker': NormalizedMessage;
  'message.location': NormalizedMessage;
  'message.contact': NormalizedMessage;
  'message.reaction': NormalizedMessage;
  /** El cliente ha hecho un pedido desde el catálogo. */
  'message.order': NormalizedMessage;
  /** El cliente ha tocado un producto del catálogo para preguntar por él. */
  'message.product': NormalizedMessage;
  /** Tarjeta de evento de calendario (la manda el consumidor; entra el eco y las ajenas). */
  'message.event': NormalizedMessage;
  /** Un invitado ha contestado a la invitación: va / no va / quizá. */
  'message.event_response': NormalizedMessage;
  /** Mensaje crudo del volcado de histórico, antes de normalizar. */
  'history.message': unknown;
  /** Mensaje del histórico ya normalizado. Va aparte de los de siempre a propósito. */
  'message.history': NormalizedMessage;
  'history.synced': HistorySyncedEvent;
  'presence.contact': PresenceContactEvent;
  'call': CallEvent;
  'message.status': MessageStatusEvent;
  'message.forwarded': MessageForwardedEvent;
  'auth.logged-out': LoggedOutEvent;
  'auth.state-change': AuthStateChangeEvent;
  'webhook.circuit-open': CircuitOpenEvent;
  'media.downloaded': MediaDownloadedEvent;
  'error': ErrorEvent;
}

/** Se acabó de volcar el histórico de una línea. */
export interface HistorySyncedEvent {
  sessionId: string;
  accountId?: string | null;
  userId?: string | null;
  /** Mensajes emitidos, ya recortados al tope. */
  count: number;
  /** Los que no cupieron en el tope. */
  skipped: number;
}

export type WACoreEventName = keyof WACoreEventMap;

/**
 * Los eventos del bus que transportan un mensaje entrante.
 *
 * Es la lista **canónica**: la consumen el publicador de RabbitMQ, el despachador de webhooks y
 * el buffer de sondeo. Antes cada uno llevaba su propia copia y habían divergido — las de
 * transporte se habían quedado en seis tipos, así que las notas de voz, los stickers, las
 * ubicaciones y los contactos que el router sí normalizaba no salían nunca del proceso.
 *
 * Al añadir un `MessageType` nuevo hay que añadirlo aquí, y solo aquí.
 */
export const MESSAGE_EVENT_NAMES: readonly WACoreEventName[] = [
  'message.text',
  'message.image',
  'message.video',
  'message.document',
  'message.audio',
  'message.ptt',
  'message.sticker',
  'message.location',
  'message.contact',
  'message.reaction',
  'message.order',
  'message.product',
  'message.event',
  'message.event_response',
] as const;

// ─── Sesión ───────────────────────────────────────────────────

export interface AuthenticationCreds {
  noiseKey: { private: { type: string; data: Uint8Array }; public: { type: string; data: Uint8Array } };
  signedIdentityKey: { private: { type: string; data: Uint8Array }; public: { type: string; data: Uint8Array } };
  signedPreKey: { keyPair: { private: { type: string; data: Uint8Array }; public: { type: string; data: Uint8Array } }; signature: Uint8Array; keyId: number };
  registrationId: number;
  advSecretKey: string;
  nextPreKeyId: number;
  firstUnuploadedPreKeyId: number;
  serverHasPreKeys: boolean;
  [key: string]: unknown;
}

export interface AuthenticationState {
  creds: AuthenticationCreds;
  keys: unknown;
}

// ─── Estado de conexión ───────────────────────────────────────

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'awaiting-qr' | 'logged-out' | 'failed';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  connection: ConnectionStatus;
  phoneNumber: string | null;
  uptimeSeconds: number;
  reconnections: number;
}

// ─── Estados de reconnection ──────────────────────────────────

export type DisconnectReason =
  | 'connectionReplaced'
  | 'timedOut'
  | 'loggedOut'
  | 'unavailableService'
  | 'badSession'
  | 'restartRequired'
  | 'multidevice'
  | 'forbidden'
  | 'unknown';

export interface BackoffConfig {
  initialDelay: number;
  maxDelay: number;
  factor: number;
  maxAttempts: number;
}

// ─── Webhook ──────────────────────────────────────────────────

export interface WebhookPayload {
  event: string;
  instanceId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── REST API ─────────────────────────────────────────────────

export interface SendMessageRequest {
  to: string;
  text: string;
  quotedMessageId?: string;
  quotedParticipant?: string;
  quotedFromMe?: boolean;
}

export interface ForwardMessageRequest {
  from: string;
  messageId: string;
  to: string[];
}

export interface ForwardResult {
  to: string;
  id: string | null;
  ok: boolean;
  error?: string;
}

export interface SendMediaRequest {
  to: string;
  type: 'image' | 'video' | 'document' | 'audio';
  url: string;
  filename?: string;
  caption?: string;
  mimetype?: string;
}

export interface SendStickerRequest {
  to: string;
  url: string;
  mimetype?: string;
}

export interface SendLocationRequest {
  to: string;
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface SendButtonsRequest {
  to: string;
  body: string;
  buttons: { id: string; title: string }[];
  footer?: string;
  /** Si WhatsApp rechaza el formato interactivo, mandar el mismo contenido como texto. */
  fallbackToText?: boolean;
}

export interface SendListRequest {
  to: string;
  body: string;
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
  header?: string;
  footer?: string;
  fallbackToText?: boolean;
}

export interface EditMessageRequest {
  text: string;
}

export interface CheckNumbersRequest {
  numbers: string[];
}

export interface VCardEntry {
  vcard: string;
}

export interface SendContactRequest {
  to: string;
  displayName: string;
  contacts: VCardEntry[];
}

export interface SendPttRequest {
  to: string;
  url: string;
  mimetype?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Presence ───────────────────────────────────────────

export type PresenceType = 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';

export interface PresenceContactEvent {
  jid: string;
  isGroup: boolean;
  participant: string;
  presence: PresenceType;
  lastSeen: number | null;
  timestamp: number;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
}

export type MessageStatusCode = 0 | 1 | 2 | 3 | 4 | 5;
export type MessageStatusLabel = 'error' | 'pending' | 'server-ack' | 'delivered' | 'read' | 'played';

export interface MessageForwardedEvent {
  from: string;
  sourceMessageId: string;
  to: string;
  newMessageId: string | null;
  timestamp: number;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
}

export interface MessageStatusEvent {
  messageId: string;
  status: MessageStatusCode;
  statusLabel: MessageStatusLabel;
  chatJid: string;
  phone: string | null;
  isGroup: boolean;
  fromMe: true;
  timestamp: number;
  sessionId?: string;
  accountId?: string | null;
  userId?: string | null;
}

export interface SendPresenceRequest {
  to: string;
  type: PresenceType;
  duration?: number;
}

export interface ReadReceiptRequest {
  to: string;
  messageId?: string;
  messageIds?: string[];
  participant?: string;
}

// ─── Groups ─────────────────────────────────────────────

export type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote';
export type GroupSetting = 'announcement' | 'not_announcement' | 'locked' | 'unlocked';

export interface CreateGroupRequest {
  subject: string;
  participants: string[];
}

export interface UpdateGroupSubjectRequest {
  subject: string;
}

export interface UpdateGroupDescriptionRequest {
  description?: string;
}

export interface UpdateGroupSettingsRequest {
  setting: GroupSetting;
}

export interface UpdateGroupParticipantsRequest {
  action: GroupParticipantAction;
  participants: string[];
}

export interface AcceptGroupInviteRequest {
  code: string;
}

// ─── Profile ────────────────────────────────────────────

export interface UpdateProfileNameRequest {
  name: string;
}

export interface UpdateProfileStatusRequest {
  status: string;
}

export interface UpdateProfilePictureRequest {
  imageUrl?: string;
  imageData?: string;
}

export interface ProfileMeResponse {
  jid: string;
  phone: string;
  name: string | null;
  status: string | null;
  picture: string | null;
}

export interface ContactProfileResponse {
  jid: string;
  exists: boolean;
  picture: string | null;
  status: string | null;
  businessProfile: unknown | null;
}

// ─── Sistema de comandos ────────────────────────────────────────

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  usage?: string;
  handler: (message: NormalizedMessage, args: string[], reply: ReplyFn) => void | Promise<void>;
}

export type ReplyFn = (text: string) => Promise<string>;

export interface CommandRegistry {
  register(command: Command): void;
  unregister(name: string): void;
  get(name: string): Command | undefined;
  getAll(): Command[];
  start(): void;
  stop(): void;
}

// ─── Incoming Message Hub ──────────────────────────────────────

export type MessageHandler = (msg: NormalizedMessage) => void | Promise<void>;

export interface MessageBufferConfig {
  maxSize: number;
  ttlMs: number;
}

export interface PollMessagesResponse {
  messages: NormalizedMessage[];
  cursor: string | null;
  hasMore: boolean;
}
