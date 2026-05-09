import { useEffect, useState } from 'react';
import { fetchContacts } from '../api';
import type { Contact } from '../types';

interface Props {
  onSelect: (phone: string) => void;
}

export default function ContactList({ onSelect }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetchContacts();
    if (res.success && res.data) {
      setContacts(res.data.contacts);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="panel contact-panel">
      <div className="panel-header">
        <h2>Contactos</h2>
        <button onClick={load} disabled={loading} className="btn-sm">
          {loading ? '...' : '↻'}
        </button>
      </div>

      <div className="contact-list">
        {contacts.length === 0 && <div className="empty-state">Sin contactos aún</div>}
        {contacts.map((c) => (
          <div key={c.phone} className="contact-item" onClick={() => onSelect(c.phone)}>
            <div className="contact-avatar">{c.name.charAt(0).toUpperCase()}</div>
            <div className="contact-info">
              <div className="contact-name">{c.name}</div>
              <div className="contact-phone">{c.phone}</div>
            </div>
            <button
              className="btn-sm"
              onClick={(e) => { e.stopPropagation(); onSelect(c.phone); }}
              title="Enviar mensaje"
            >
              ✉
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
