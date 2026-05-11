import type { ApiResponse, StatusData, QrData, SendData, ContactsData, PollMessagesData } from './types';

const LS_KEY = 'wacore_dev_api';

const ENV_URL = import.meta.env.VITE_API_URL || 'http://localhost:9878';
const ENV_KEY = import.meta.env.VITE_API_KEY || '';

function loadApiConfig(): { url: string; key: string } {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.url || parsed.key) return parsed;
    }
  } catch { /* ignore */ }
  return { url: ENV_URL, key: ENV_KEY };
}

function saveApiConfig(url: string, key: string): void {
  localStorage.setItem(LS_KEY, JSON.stringify({ url, key }));
}

let config = loadApiConfig();
console.log('[api] initial config:', { url: config.url, key: config.key ? `${config.key.slice(0, 4)}...` : '(empty)' });

export function getApiConfig() {
  return { ...config };
}

export function setApiConfig(url: string, key: string) {
  config = { url: url.replace(/\/+$/, ''), key };
  saveApiConfig(config.url, config.key);
  console.log('[api] config updated:', { url: config.url, key: config.key ? `${config.key.slice(0, 4)}...` : '(empty)' });
}

export function getEnvConfig() {
  return { url: ENV_URL, key: ENV_KEY };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const base = config.url || '';
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.key}`,
      ...init?.headers,
    },
  });
  return res.json() as Promise<ApiResponse<T>>;
}

export async function fetchStatus() {
  return apiFetch<StatusData>('/api/status');
}

export async function fetchQr() {
  return apiFetch<QrData>('/api/qr');
}

export async function sendMessage(to: string, text: string) {
  return apiFetch<SendData>('/api/send', {
    method: 'POST',
    body: JSON.stringify({ to, text }),
  });
}

export async function sendMedia(to: string, type: string, url: string, caption?: string, filename?: string, mimetype?: string) {
  return apiFetch<SendData>('/api/send-media', {
    method: 'POST',
    body: JSON.stringify({ to, type, url, caption, filename, mimetype }),
  });
}

export async function deleteSession() {
  return apiFetch<{ loggedOut: boolean }>('/api/session', {
    method: 'DELETE',
  });
}

export async function fetchContacts() {
  return apiFetch<ContactsData>('/api/contacts');
}

export async function fetchMessages(since?: string, limit?: number) {
  const params = new URLSearchParams();
  if (since) params.set('since', since);
  if (limit) params.set('limit', String(limit ?? 50));
  const qs = params.toString();
  return apiFetch<PollMessagesData>(`/api/messages${qs ? '?' + qs : ''}`);
}

export async function postConnect() {
  return apiFetch<{ connecting: boolean }>('/api/connect', {
    method: 'POST',
  });
}

export function connectSSE(
  onMessage: (data: string) => void,
  onConnected: () => void,
  onDisconnected: () => void,
  onConnection: (data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const base = config.url || '';
    const sseUrl = `${base}/api/messages/stream?api_key=${encodeURIComponent(config.key)}`;
    console.log('[sse] EventSource URL:', sseUrl);

    const es = new EventSource(sseUrl);

    es.onopen = () => {
      console.log('[sse] connected');
      onConnected();
    };

    const msgTypes = ['text', 'image', 'video', 'document', 'audio', 'reaction'];
    for (const t of msgTypes) {
      es.addEventListener(t, (e) => {
        if ((e as MessageEvent).data) onMessage((e as MessageEvent).data);
      });
    }

    es.addEventListener('connection', (e) => {
      if ((e as MessageEvent).data) onConnection((e as MessageEvent).data);
    });

    es.onerror = () => {
      console.warn('[sse] connection lost, will auto-reconnect');
      onDisconnected();
    };

    signal.addEventListener('abort', () => {
      es.close();
      resolve();
    }, { once: true });
  });
}
