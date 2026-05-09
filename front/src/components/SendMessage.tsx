import { useEffect, useState } from 'react';
import { sendMessage } from '../api';
import type { LogData } from '../types';

interface Props {
  preselectedPhone?: string;
  onSent: (entry: LogData) => void;
}

export default function SendMessage({ preselectedPhone, onSent }: Props) {
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (preselectedPhone) {
      setTo(preselectedPhone);
      setError('');
    }
  }, [preselectedPhone]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!to.trim() || !text.trim()) return;
    setSending(true);
    setError('');
    const res = await sendMessage(to.trim(), text.trim());
    if (res.success && res.data) {
      onSent({
        id: res.data.id,
        direction: 'outgoing',
        from: to.trim(),
        phone: to.trim(),
        pushName: to.trim(),
        body: text.trim(),
        timestamp: Math.floor(Date.now() / 1000),
        type: 'text',
      });
      setText('');
    } else {
      setError(res.error || 'Error al enviar');
    }
    setSending(false);
  }

  return (
    <div className="panel send-panel">
      <div className="panel-header">
        <h2>Enviar mensaje</h2>
      </div>

      <form onSubmit={handleSubmit} className="send-form">
        <label>
          Destino (número o JID):
          <input
            type="text"
            placeholder="5215512345678"
            value={to}
            onChange={e => setTo(e.target.value)}
          />
        </label>
        <label>
          Mensaje:
          <textarea
            placeholder="Escribe tu mensaje..."
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
          />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button type="submit" disabled={sending || !to.trim() || !text.trim()} className="btn-primary">
          {sending ? 'Enviando...' : 'Enviar'}
        </button>
      </form>
    </div>
  );
}
