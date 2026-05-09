import type { Logger } from '../utils/logger';
import type { EnvConfig, SendMessageRequest, SendMediaRequest, ApiResponse, PollMessagesResponse } from '../types';
import type { IncomingMessageHub } from '../core/incoming-message-hub';
import type { SSETransport } from './sse-transport';

export interface RestApi {
  start(): void;
  stop(): void;
}

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
  incomingHub?: IncomingMessageHub,
  sseTransport?: SSETransport,
): RestApi {
  if (!config.apiKey) {
    return {
      start() { logger.info('REST API disabled (no API_KEY configured)'); },
      stop() {},
    };
  }

  let server: ReturnType<typeof Bun.serve> | null = null;

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  function authenticate(req: Request): boolean {
    const auth = req.headers.get('Authorization');
    if (auth === `Bearer ${config.apiKey}`) return true;
    const url = new URL(req.url);
    return url.searchParams.get('api_key') === config.apiKey;
  }

  function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  async function handlePostSend(req: Request): Promise<Response> {
    const body = await req.json() as SendMessageRequest;
    if (!body.to || !body.text) {
      return jsonResponse({ success: false, error: 'Missing required fields: to, text' }, 400);
    }
    try {
      const id = await sendMessage(body.to, body.text);
      return jsonResponse({ success: true, data: { id } });
    } catch (err) {
      return jsonResponse({ success: false, error: String(err) }, 500);
    }
  }

  async function handlePostSendMedia(req: Request): Promise<Response> {
    const body = await req.json() as SendMediaRequest;
    if (!body.to || !body.url || !body.type) {
      return jsonResponse({ success: false, error: 'Missing required fields: to, url, type' }, 400);
    }
    try {
      const id = await sendMedia(body);
      return jsonResponse({ success: true, data: { id } });
    } catch (err) {
      return jsonResponse({ success: false, error: String(err) }, 500);
    }
  }

  function handleGetStatus(): Response {
    return jsonResponse({
      success: true,
      data: {
        status: getConnectionStatus(),
        instance: config.instanceName,
      },
    });
  }

  function handleGetQr(): Response {
    const qr = getQr();
    if (!qr) {
      return jsonResponse({ success: false, error: 'No QR available (already connected?)' }, 404);
    }
    return jsonResponse({ success: true, data: { qr } });
  }

  async function handleDeleteSession(): Promise<Response> {
    try {
      await logout();
      return jsonResponse({ success: true, data: { loggedOut: true } });
    } catch (err) {
      return jsonResponse({ success: false, error: String(err) }, 500);
    }
  }

  function handleGetMessages(req: Request): Response {
    if (!config.pollingEnabled || !incomingHub) {
      return jsonResponse({ success: false, error: 'Polling not enabled' }, 404);
    }
    const url = new URL(req.url);
    const since = url.searchParams.get('since') || undefined;
    const limitParam = url.searchParams.get('limit');
    let limit = 50;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (!isNaN(parsed) && parsed > 0) limit = Math.min(parsed, 200);
    }
    const result: PollMessagesResponse = incomingHub.getRecentMessages(since, limit);
    return jsonResponse({ success: true, data: result });
  }

  function handleGetContacts(): Response {
    try {
      const contacts = getContacts();
      return jsonResponse({ success: true, data: { contacts } });
    } catch (err) {
      return jsonResponse({ success: false, error: String(err) }, 500);
    }
  }

  async function handlePostConnect(): Promise<Response> {
    try {
      await connect();
      return jsonResponse({ success: true, data: { connecting: true } });
    } catch (err) {
      return jsonResponse({ success: false, error: String(err) }, 500);
    }
  }

  return {
    start() {
      server = Bun.serve({
        port,
        fetch: async (req) => {
          if (req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
          }

          if (!authenticate(req)) {
            return jsonResponse({ success: false, error: 'Unauthorized' }, 401);
          }

          const url = new URL(req.url);
          const method = req.method;

          if (method === 'POST' && url.pathname === '/api/send') return handlePostSend(req);
          if (method === 'POST' && url.pathname === '/api/send-media') return handlePostSendMedia(req);
          if (method === 'GET' && url.pathname === '/api/status') return handleGetStatus();
          if (method === 'GET' && url.pathname === '/api/qr') return handleGetQr();
          if (method === 'DELETE' && url.pathname === '/api/session') return handleDeleteSession();
          if (method === 'GET' && url.pathname === '/api/messages') return handleGetMessages(req);
          if (method === 'GET' && url.pathname === '/api/contacts') return handleGetContacts();
          if (method === 'POST' && url.pathname === '/api/connect') return handlePostConnect();
          if (method === 'GET' && url.pathname === '/api/messages/stream') {
            if (!sseTransport) {
              return jsonResponse({ success: false, error: 'SSE not enabled' }, 404);
            }
            return sseTransport.handleConnection(req);
          }

          return jsonResponse({ success: false, error: 'Not Found' }, 404);
        },
      });

      logger.info('REST API started', { port });
    },

    stop() {
      server?.stop();
      server = null;
    },
  };
}
