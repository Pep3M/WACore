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

export function getApiConfig() {
  return { ...config };
}

export function setApiConfig(url: string, key: string) {
  config = { url: url.replace(/\/+$/, ''), key };
  saveApiConfig(config.url, config.key);
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

export async function connectSSE(
  onMessage: (data: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const base = config.url || '';
  const res = await fetch(`${base}/api/messages/stream`, {
    headers: { Authorization: `Bearer ${config.key}` },
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`SSE connection failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6);
        if (!payload.includes('ping')) {
          onMessage(payload);
        }
      }
    }
  }
}
