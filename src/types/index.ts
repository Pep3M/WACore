// Tipos compartidos del dominio WACore

// ─── Configuración ────────────────────────────────────────────

export interface EnvConfig {
  instanceName: string;
  healthPort: number;
  apiPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  sessionStore: 'file' | 'redis' | 'postgres';
  sessionDir: string;
  databaseUrl?: string;
  redisUrl?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookEvents: string[];
  webhookRetryCount: number;
  webhookRetryDelay: number;
  apiKey?: string;
  connectOnStartup: boolean;
  qrTimeout: number;
  nodeEnv: string;
  pollingEnabled: boolean;
  sseEnabled: boolean;
  messageBufferSize: number;
  messageBufferTtlMs: number;
  sseHeartbeatMs: number;
  autoTyping: boolean;
  typingDurationMs: number;
}

// ─── Eventos del bus interno ──────────────────────────────────

export interface ConnectionUpdateEvent {
  status: 'connecting' | 'connected' | 'disconnecting' | 'disconnected';
  previous?: string;
  phoneNumber?: string;
  reason?: string;
  statusCode?: number;
}

export interface QREvent {
  qr: string;
  timeout: number;
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
}

export type MessageType = 'text' | 'image' | 'video' | 'document' | 'audio' | 'reaction' | 'unknown';

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
  'message.reaction': NormalizedMessage;
  'auth.logged-out': LoggedOutEvent;
  'auth.state-change': AuthStateChangeEvent;
  'webhook.circuit-open': CircuitOpenEvent;
  'error': ErrorEvent;
}

export type WACoreEventName = keyof WACoreEventMap;

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
}

export interface SendMediaRequest {
  to: string;
  type: 'image' | 'video' | 'document' | 'audio';
  url: string;
  filename?: string;
  caption?: string;
  mimetype?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Presence ───────────────────────────────────────────

export type PresenceType = 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';

export interface SendPresenceRequest {
  to: string;
  type: PresenceType;
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
