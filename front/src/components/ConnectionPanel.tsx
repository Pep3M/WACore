import { useEffect, useRef, useState } from 'react';
import { fetchStatus, fetchQr, deleteSession, postConnect, getApiConfig, setApiConfig, getEnvConfig } from '../api';
import QRCode from 'qrcode';

function QrDisplay({ qrRaw }: { qrRaw: string }) {
  const [dataUrl, setDataUrl] = useState('');
  useEffect(() => {
    QRCode.toDataURL(qrRaw, { width: 220, margin: 2 })
      .then(setDataUrl)
      .catch(() => setDataUrl(''));
  }, [qrRaw]);
  if (!dataUrl) return <div className="qr-placeholder">Generando QR...</div>;
  return <img src={dataUrl} alt="WhatsApp QR" className="qr-img" />;
}

interface Props {
  onStatusChange: () => void;
}

export default function ConnectionPanel({ onStatusChange }: Props) {
  const [status, setStatus] = useState('disconnected');
  const [phone, setPhone] = useState('');
  const [instance, setInstance] = useState('');
  const [qrRaw, setQrRaw] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState(getApiConfig().url);
  const [apiKey, setApiKey] = useState(getApiConfig().key);
  const [connecting, setConnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const env = getEnvConfig();
  const cfgChanged = apiUrl !== getApiConfig().url || apiKey !== getApiConfig().key;
  const hasEnvKey = !!env.key;
  const hasCustomUrl = !!env.url && env.url !== 'http://localhost:9878';
  const isAutoConfigured = hasEnvKey || hasCustomUrl;

  function applyConfig() {
    setApiConfig(apiUrl, apiKey);
    onStatusChange();
  }

  async function poll() {
    const res = await fetchStatus();
    if (res.success && res.data) {
      setStatus(res.data.status);
      setInstance(res.data.instance);
      if (res.data.status === 'connected') {
        void fetchStatus().then(r => {
          if (r.success && r.data) setPhone((r.data as any).phone || '');
        });
      }
    }
  }

  async function pollQr() {
    if (status !== 'awaiting-qr') { setQrRaw(null); return; }
    const res = await fetchQr();
    if (res.success && res.data) {
      setQrRaw(res.data.qr);
    } else {
      setQrRaw(null);
    }
  }

  useEffect(() => {
    const current = getApiConfig();
    const needsUrl = !!env.url && env.url !== current.url;
    const needsKey = !!env.key && env.key !== current.key;
    if (needsUrl || needsKey) {
      const newUrl = env.url || current.url;
      const newKey = env.key || current.key;
      setApiConfig(newUrl, newKey);
      setApiUrl(newUrl);
      setApiKey(newKey);
      onStatusChange();
    } else if (!current.url && !current.key && !env.url && !env.key) {
      setApiUrl('http://localhost:9878');
    }
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => clearInterval(pollRef.current);
  }, []);

  useEffect(() => {
    pollQr();
  }, [status]);

  async function handleConnect() {
    setConnecting(true);
    await postConnect();
    setTimeout(() => setConnecting(false), 3000);
  }

  async function handleDisconnect() {
    await deleteSession();
    setQrRaw(null);
    setPhone('');
    poll();
  }

  const colorMap: Record<string, string> = {
    connected: '#22c55e',
    connecting: '#f59e0b',
    'awaiting-qr': '#f59e0b',
    disconnected: '#6b7280',
    'logged-out': '#ef4444',
    failed: '#ef4444',
  };

  return (
    <div className="panel connection-panel">
      <div className="panel-header">
        <h2>Conexión</h2>
        <span className="status-badge" style={{ backgroundColor: colorMap[status] || '#6b7280' }}>
          {status}
        </span>
      </div>

      {!isAutoConfigured && (
        <div className="conn-form">
          <input
            type="text"
            placeholder="API URL (ej: http://localhost:9878)"
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
          />
          <input
            type="password"
            placeholder="API Key"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <button onClick={applyConfig} disabled={!cfgChanged}>
            Aplicar
          </button>
        </div>
      )}

      <div className="conn-info">
        <div>Instancia: <strong>{instance || '-'}</strong></div>
        <div>Teléfono: <strong>{phone || '-'}</strong></div>
      </div>

      <div className="conn-actions">
        {(status === 'disconnected' || status === 'logged-out') && (
          <button onClick={handleConnect} disabled={connecting} className="btn-primary">
            {connecting ? 'Conectando...' : 'Conectar'}
          </button>
        )}
        {status === 'connected' && (
          <button onClick={handleDisconnect} className="btn-danger">
            Desconectar
          </button>
        )}
      </div>

      {status === 'awaiting-qr' && qrRaw && (
        <div className="qr-section">
          <p className="qr-hint">Escanea con WhatsApp → Ajustes → Dispositivos vinculados</p>
          <QrDisplay qrRaw={qrRaw} />
        </div>
      )}
    </div>
  );
}
