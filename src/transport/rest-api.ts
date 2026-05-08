import type { Logger } from '../utils/logger';
import type { EnvConfig, SendMessageRequest, SendMediaRequest, ApiResponse } from '../types';

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
): RestApi {
  if (!config.apiKey) {
    return {
      start() { logger.info('REST API disabled (no API_KEY configured)'); },
      stop() {},
    };
  }

  let server: ReturnType<typeof Bun.serve> | null = null;

  function authenticate(req: Request): boolean {
    const auth = req.headers.get('Authorization');
    return auth === `Bearer ${config.apiKey}`;
  }

  function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
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

  return {
    start() {
      server = Bun.serve({
        port,
        fetch: async (req) => {
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
