import { useEffect, useRef, useState } from 'react';
import { fetchMessages, sendMessage as apiSendMessage, connectSSE } from '../api';
import type { LogData, NormalizedMessage } from '../types';

interface Props {
  log: LogData[];
  onNewLog: (msg: LogData) => void;
}

export default function MessageList({ log, onNewLog }: Props) {
  const [echoMode, setEchoMode] = useState(false);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'error' | 'off'>('off');
  const echoRef = useRef(echoMode);
  const cursorRef = useRef<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const listEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  echoRef.current = echoMode;

  function toLogEntry(msg: NormalizedMessage): LogData {
    return {
      id: msg.id,
      direction: 'incoming',
      from: msg.from,
      phone: msg.phone,
      pushName: msg.pushName || msg.phone,
      body: msg.body,
      timestamp: msg.timestamp,
      type: msg.type,
    };
  }

  async function pollMessages() {
    try {
      const res = await fetchMessages(cursorRef.current || undefined, 50);
      if (!res.success || !res.data) return;
      const { messages, cursor } = res.data;
      for (const msg of messages) {
        if (seenRef.current.has(msg.id)) continue;
        seenRef.current.add(msg.id);
        const entry = toLogEntry(msg);
        onNewLog(entry);

        if (echoRef.current && msg.body && msg.from && !msg.isGroup) {
          const replyText = `Echo: ${msg.body}`;
          apiSendMessage(msg.from, replyText).then(() => {
            const sent: LogData = {
              id: `out-${Date.now()}`,
              direction: 'outgoing',
              from: msg.from,
              phone: msg.phone,
              pushName: msg.pushName || msg.phone,
              body: replyText,
              timestamp: Math.floor(Date.now() / 1000),
              type: 'text',
            };
            onNewLog(sent);
          }).catch(() => {});
        }
      }
      if (cursor) cursorRef.current = cursor;
    } catch (err) {
      /* polling error, retry on next interval */
    }
  }

  useEffect(() => {
    pollMessages();
    pollRef.current = setInterval(pollMessages, 2000);
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setSseStatus('connecting');

    (async () => {
      try {
        await connectSSE((payload) => {
          setSseStatus('connected');
          try {
            const msg: NormalizedMessage = JSON.parse(payload);
            if (seenRef.current.has(msg.id)) return;
            seenRef.current.add(msg.id);
            onNewLog(toLogEntry(msg));
          } catch (parseErr) {
            console.error('SSE parse:', parseErr);
          }
        }, ac.signal);
      } catch (err) {
        if (!ac.signal.aborted) {
          console.error('SSE failed, using polling only:', err);
          setSseStatus('error');
        }
      }
    })();

    return () => ac.abort();
  }, []);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  const sseColor: Record<string, string> = { off: '#6b7280', connecting: '#f59e0b', connected: '#22c55e', error: '#ef4444' };

  return (
    <div className="panel message-panel">
      <div className="panel-header">
        <h2>Mensajes</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '0.7rem', color: sseColor[sseStatus] }}>
            {sseStatus === 'connected' ? 'SSE ✓' : sseStatus === 'off' ? 'polling' : `SSE: ${sseStatus}`}
          </span>
          <label className="echo-toggle">
            <input type="checkbox" checked={echoMode} onChange={e => setEchoMode(e.target.checked)} />
            Echo mode
          </label>
        </div>
      </div>

      <div className="message-list">
        {log.length === 0 && (
          <div className="empty-state">Esperando mensajes... (polling activo)</div>
        )}
        {log.map((entry) => (
          <div key={entry.id} className={`msg-entry ${entry.direction}`}>
            <div className="msg-meta">
              <span className="msg-direction">{entry.direction === 'incoming' ? '←' : '→'}</span>
              <span className="msg-sender">{entry.pushName}</span>
              <span className="msg-phone">{entry.phone}</span>
              <span className="msg-time">{new Date(entry.timestamp * 1000).toLocaleTimeString()}</span>
            </div>
            <div className="msg-body">{entry.body || `[${entry.type}]`}</div>
          </div>
        ))}
        <div ref={listEndRef} />
      </div>
    </div>
  );
}
