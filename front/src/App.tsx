import { useEffect, useRef, useState, useCallback } from 'react';
import { fetchStatus, fetchContacts, sendMessage, sendMedia, connectSSE, setApiConfig, getApiConfig, getEnvConfig } from './api';
import QRCode from 'qrcode';
import type { LogData, NormalizedMessage, MediaInfo, Contact } from './types';

const MEDIA_TYPES = ['image', 'video', 'document', 'audio'] as const;
type MediaType = typeof MEDIA_TYPES[number];

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
    media: msg.media ?? null,
    mediaId: msg.media?.mediaId,
  };
}

function mediaIcon(type: string): string {
  switch (type) {
    case 'image': return '🖼️';
    case 'video': return '🎬';
    case 'document': return '📄';
    case 'audio': return '🎵';
    case 'reaction': return '💬';
    default: return '📝';
  }
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
  const [sendMediaType, setSendMediaType] = useState<MediaType>('image');
  const [sendMediaUrl, setSendMediaUrl] = useState('');
  const [sendMediaCaption, setSendMediaCaption] = useState('');
  const [sendMediaFilename, setSendMediaFilename] = useState('');
  const [sseKey, setSseKey] = useState(0);
  const echoRef = useRef(false);

  echoRef.current = echoMode;

  const env = getEnvConfig();
  const cfgChanged = apiUrl !== getApiConfig().url || apiKey !== getApiConfig().key;
  const hasEnvKey = !!env.key;
  const hasCustomUrl = !!env.url && env.url !== 'http://localhost:9878';
  const isAutoConfigured = hasEnvKey || hasCustomUrl;

  function applyConfig() {
    setApiConfig(apiUrl, apiKey);
    setSseKey(k => k + 1);
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
    setSseStatus('connecting');

    connectSSE(
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
      () => setSseStatus('connecting'),
      (payload) => {
        try {
          const conn = JSON.parse(payload);
          setStatus(conn.status || 'disconnected');
          if (conn.phone) setPhone(conn.phone);
        } catch {}
      },
      ac.signal,
    );

    return () => ac.abort();
  }, [sseKey]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!sendTo.trim()) return;
    setSending(true);
    setSendError('');

    const isMedia = sendMediaUrl.trim().length > 0;
    let res: Awaited<ReturnType<typeof sendMessage>>;

    if (isMedia) {
      res = await sendMedia(
        sendTo.trim(),
        sendMediaType,
        sendMediaUrl.trim(),
        sendMediaCaption.trim() || undefined,
        sendMediaFilename.trim() || undefined,
      );
    } else {
      if (!sendText.trim()) { setSendError('Escribe un texto o proporciona una URL de media'); setSending(false); return; }
      res = await sendMessage(sendTo.trim(), sendText.trim());
    }

    if (res.success && res.data) {
      const entryType = isMedia ? sendMediaType : 'text';
      const entryBody = isMedia ? (sendMediaCaption.trim() || `[${sendMediaType}]`) : sendText.trim();
      setLog(prev => ([{
        id: res.data!.id, direction: 'outgoing' as const, from: sendTo.trim(),
        phone: sendTo.trim(), pushName: sendTo.trim(), body: entryBody,
        timestamp: Math.floor(Date.now() / 1000), type: entryType,
        media: isMedia ? { mimetype: '', filename: sendMediaFilename.trim() || undefined, caption: sendMediaCaption.trim() || undefined } : null,
      }, ...prev] as LogData[]).slice(0, 500));
      setSendText('');
      setSendMediaUrl('');
      setSendMediaCaption('');
      setSendMediaFilename('');
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
                  <span className="msg-type">{mediaIcon(entry.type)} {entry.type}</span>
                  <span className="msg-time">{new Date(entry.timestamp * 1000).toLocaleTimeString()}</span>
                </div>
                <div className="msg-body">{entry.body || `[${entry.type}]`}</div>
                {entry.media && entry.media.mediaId && (
                  <div className="msg-media-link">
                    <a href={`/api/media/${entry.media.mediaId}`} target="_blank" rel="noopener noreferrer" onClick={e => { e.preventDefault(); window.open(`/api/media/${entry.media.mediaId}`, '_blank'); }}>
                      📎 {entry.media.filename || `${entry.media.mediaId}.${entry.media.mimetype?.split('/')[1] || 'bin'}`}
                    </a>
                    {entry.media.downloaded ? ' ✅' : ' ⏳'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="panel send-panel">
          <div className="panel-header"><h2>Enviar mensaje</h2></div>
          <form onSubmit={handleSend} className="send-form">
            <label>Destino:<input type="text" placeholder="5215512345678" value={sendTo} onChange={e => setSendTo(e.target.value)} /></label>

            <div className="media-type-selector">
              <span className="media-type-label">Tipo:</span>
              {MEDIA_TYPES.map(t => (
                <button key={t} type="button" className={`media-type-btn ${sendMediaType === t ? 'active' : ''}`} onClick={() => setSendMediaType(t)}>
                  {mediaIcon(t)} {t}
                </button>
              ))}
              <button type="button" className={`media-type-btn ${sendMediaUrl === '' ? 'active' : ''}`} onClick={() => { setSendMediaUrl(''); setSendMediaCaption(''); setSendMediaFilename(''); }}>
                📝 Texto
              </button>
            </div>

            <label>Media URL (opcional):
              <input type="text" placeholder={sendMediaUrl === '' ? 'https://ejemplo.com/imagen.jpg (dejar vacío para texto)' : 'https://...'} value={sendMediaUrl} onChange={e => setSendMediaUrl(e.target.value)} />
            </label>

            {sendMediaUrl.trim() && (
              <>
                <label>Caption:<input type="text" placeholder="Texto que acompaña al archivo" value={sendMediaCaption} onChange={e => setSendMediaCaption(e.target.value)} /></label>
                {sendMediaType === 'document' && (
                  <label>Filename:<input type="text" placeholder="documento.pdf" value={sendMediaFilename} onChange={e => setSendMediaFilename(e.target.value)} /></label>
                )}
              </>
            )}

            {!sendMediaUrl.trim() && (
              <label>Mensaje:<textarea placeholder="..." value={sendText} onChange={e => setSendText(e.target.value)} rows={3} /></label>
            )}

            {sendError && <div className="form-error">{sendError}</div>}
            <button type="submit" disabled={sending || !sendTo.trim() || (!sendText.trim() && !sendMediaUrl.trim())} className="btn-primary">
              {sending ? 'Enviando...' : sendMediaUrl.trim() ? `Enviar ${sendMediaType}` : 'Enviar texto'}
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
