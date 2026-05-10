import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchStatus, fetchContacts, sendMessage, connectSSE, setApiConfig, getApiConfig, getEnvConfig } from './api';
import QRCode from 'qrcode';
import type { LogData, NormalizedMessage, Contact } from './types';

function toLogEntry(msg: NormalizedMessage): LogData {
  const ts = typeof msg.timestamp === 'number' ? msg.timestamp
    : (msg.timestamp as any)?.low ? (msg.timestamp as any).low : Math.floor(Date.now() / 1000);
  return {
    id: msg.id,
    direction: 'incoming',
    from: msg.from,
    phone: msg.phone,
    pushName: msg.pushName || msg.phone,
    body: msg.body,
    timestamp: ts,
    type: msg.type,
  };
}

export default function App() {
  const [log, setLog] = useState<LogData[]>([]);
  const [status, setStatus] = useState('disconnected');
  const [phone, setPhone] = useState('');
  const [instance, setInstance] = useState('');
  const [qrRaw, setQrRaw] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [echoMode, setEchoMode] = useState(false);
  const [apiUrl, setApiUrl] = useState(getApiConfig().url);
  const [apiKey, setApiKey] = useState(getApiConfig().key);
  const [preselectPhone, setPreselectPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [sendTo, setSendTo] = useState('');
  const [sendText, setSendText] = useState('');
  const [sendError, setSendError] = useState('');
  const echoRef = useRef(false);
  const connectionsRef = useRef(0);

  echoRef.current = echoMode;

  const env = getEnvConfig();
  const cfgChanged = apiUrl !== getApiConfig().url || apiKey !== getApiConfig().key;
  const hasEnvKey = !!env.key;
  const hasCustomUrl = !!env.url && env.url !== 'http://localhost:9878';
  const isAutoConfigured = hasEnvKey || hasCustomUrl;

  function applyConfig() {
    setApiConfig(apiUrl, apiKey);
  }

  useEffect(() => {
    const current = getApiConfig();
    const needsUrl = !!env.url && env.url !== current.url;
    const needsKey = !!env.key && env.key !== current.key;
    if (needsUrl || needsKey) {
      const nu = env.url || current.url;
      const nk = env.key || current.key;
      setApiConfig(nu, nk);
      setApiUrl(nu);
      setApiKey(nk);
    } else if (!current.url && !current.key && !env.url && !env.key) {
      setApiUrl('http://localhost:9878');
    }
  }, []);

  useEffect(() => {
    fetchStatus().then(r => {
      if (r.success && r.data) { setStatus(r.data.status); setInstance(r.data.instance); }
    });
    fetchContacts().then(r => {
      if (r.success && r.data) setContacts(r.data.contacts);
    });
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    connectionsRef.current++;
    setSseStatus('connecting');

    (async () => {
      try {
        await connectSSE(
          (payload) => {
            try {
              const msg: NormalizedMessage = JSON.parse(payload);
              const entry = toLogEntry(msg);
              setLog(prev => [entry, ...prev].slice(0, 500) as LogData[]);
              setContacts(prev => {
                if (!msg.pushName || msg.isGroup) return prev;
                if (prev.some(c => c.phone === msg.phone)) return prev;
                return [...prev, { phone: msg.phone, name: msg.pushName }];
              });
              if (echoRef.current && msg.body && msg.from && !msg.isGroup) {
                sendMessage(msg.from, `Echo: ${msg.body}`).then(r2 => {
                  if (r2.success && r2.data) {
                    setLog(prev => ([{
                      id: r2.data!.id, direction: 'outgoing' as const, from: msg.from,
                      phone: msg.phone, pushName: msg.pushName || msg.phone,
                      body: `Echo: ${msg.body}`, timestamp: Math.floor(Date.now() / 1000), type: 'text',
                    }, ...prev] as LogData[]).slice(0, 500));
                  }
                }).catch(() => {});
              }
            } catch {}
          },
          () => setSseStatus('connected'),
          (payload) => {
            try {
              const conn = JSON.parse(payload);
              setStatus(conn.status || 'disconnected');
              if (conn.phone) setPhone(conn.phone);
            } catch {}
          },
          ac.signal,
        );
      } catch (err) {
        if (!ac.signal.aborted) setSseStatus('error');
      }
    })();

    return () => ac.abort();
  }, []);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!sendTo.trim() || !sendText.trim()) return;
    setSending(true);
    setSendError('');
    const res = await sendMessage(sendTo.trim(), sendText.trim());
    if (res.success && res.data) {
      setLog(prev => ([{
        id: res.data!.id, direction: 'outgoing' as const, from: sendTo.trim(),
        phone: sendTo.trim(), pushName: sendTo.trim(), body: sendText.trim(),
        timestamp: Math.floor(Date.now() / 1000), type: 'text',
      }, ...prev] as LogData[]).slice(0, 500));
      setSendText('');
    } else {
      setSendError(res.error || 'Error al enviar');
    }
    setSending(false);
  }

  async function handleDisconnect() {
    const { deleteSession } = await import('./api');
    await deleteSession();
    setQrRaw(null);
    setPhone('');
  }

  async function handleConnect() {
    const { postConnect } = await import('./api');
    await postConnect();
  }

  useEffect(() => {
    if (status !== 'awaiting-qr') {
      setQrRaw(null);
      return;
    }
    const key = apiKey || getApiConfig().key;
    const base = apiUrl || getApiConfig().url;
    const url = base + '/api/qr?api_key=' + encodeURIComponent(key);
    const poll = () =>
      fetch(url).then(r => r.json()).then(r => {
        if (r.success && r.data) setQrRaw(r.data.qr);
      }).catch(() => {});
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [status, apiUrl, apiKey]);

  const sseLabel = sseStatus === 'connected' ? 'SSE ✓' : sseStatus === 'connecting' ? 'SSE conectando...' : 'SSE error';
  const sseColor = sseStatus === 'connected' ? '#22c55e' : sseStatus === 'connecting' ? '#f59e0b' : '#ef4444';

  const statusColor: Record<string, string> = {
    connected: '#22c55e', connecting: '#f59e0b', 'awaiting-qr': '#f59e0b',
    disconnected: '#6b7280', 'logged-out': '#ef4444', failed: '#ef4444',
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>WACore <span className="subtitle">Dev UI</span></h1>
      </header>

      <div className="panel connection-panel">
        <div className="panel-header">
          <h2>Conexión</h2>
          <span className="status-badge" style={{ backgroundColor: statusColor[status] || '#6b7280' }}>{status}</span>
        </div>

        {!isAutoConfigured && (
          <div className="conn-form">
            <input type="text" placeholder="API URL (ej: http://localhost:9878)" value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
            <input type="password" placeholder="API Key" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <button onClick={applyConfig} disabled={!cfgChanged}>Aplicar</button>
          </div>
        )}

        <div className="conn-info">
          <div>Instancia: <strong>{instance || '-'}</strong></div>
          <div>Teléfono: <strong>{phone || '-'}</strong></div>
        </div>

        <div className="conn-actions">
          {(status === 'disconnected' || status === 'logged-out') && (
            <button onClick={handleConnect} className="btn-primary">Conectar</button>
          )}
          {status === 'connected' && (
            <button onClick={handleDisconnect} className="btn-danger">Desconectar</button>
          )}
        </div>

        {status === 'awaiting-qr' && qrRaw && (
          <div className="qr-section">
            <p className="qr-hint">Escanea con WhatsApp → Dispositivos vinculados</p>
            <QrImg qrRaw={qrRaw} />
          </div>
        )}
      </div>

      <div className="main-grid">
        <div className="panel contact-panel">
          <div className="panel-header"><h2>Contactos</h2></div>
          <div className="contact-list">
            {contacts.length === 0 && <div className="empty-state">Sin contactos aún</div>}
            {contacts.map(c => (
              <div key={c.phone} className="contact-item" onClick={() => setSendTo(c.phone)}>
                <div className="contact-avatar">{c.name.charAt(0).toUpperCase()}</div>
                <div className="contact-info">
                  <div className="contact-name">{c.name}</div>
                  <div className="contact-phone">{c.phone}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel message-panel">
          <div className="panel-header">
            <h2>Mensajes</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '0.7rem', color: sseColor }}>{sseLabel}</span>
              <label className="echo-toggle">
                <input type="checkbox" checked={echoMode} onChange={e => setEchoMode(e.target.checked)} />
                Echo mode
              </label>
            </div>
          </div>
          <div className="message-list">
            {log.length === 0 && <div className="empty-state">Esperando mensajes...</div>}
            {log.map(entry => (
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
          </div>
        </div>

        <div className="panel send-panel">
          <div className="panel-header"><h2>Enviar mensaje</h2></div>
          <form onSubmit={handleSend} className="send-form">
            <label>Destino:<input type="text" placeholder="5215512345678" value={sendTo} onChange={e => setSendTo(e.target.value)} /></label>
            <label>Mensaje:<textarea placeholder="..." value={sendText} onChange={e => setSendText(e.target.value)} rows={3} /></label>
            {sendError && <div className="form-error">{sendError}</div>}
            <button type="submit" disabled={sending || !sendTo.trim() || !sendText.trim()} className="btn-primary">
              {sending ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function QrImg({ qrRaw }: { qrRaw: string }) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    QRCode.toDataURL(qrRaw, { width: 220, margin: 2 }).then(setDataUrl).catch(() => setDataUrl(''));
  }, [qrRaw]);
  if (!dataUrl) return <div className="qr-placeholder">Generando QR...</div>;
  return <img src={dataUrl} alt="QR" className="qr-img" />;
}
