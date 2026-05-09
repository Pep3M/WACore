import { useState, useCallback } from 'react';
import ConnectionPanel from './components/ConnectionPanel';
import MessageList from './components/MessageList';
import ContactList from './components/ContactList';
import SendMessage from './components/SendMessage';
import type { LogData } from './types';

export default function App() {
  const [log, setLog] = useState<LogData[]>([]);
  const [preselectPhone, setPreselectPhone] = useState('');
  const [configVersion, setConfigVersion] = useState(0);

  const handleNewLog = useCallback((entry: LogData) => {
    setLog(prev => [entry, ...prev].slice(0, 500));
  }, []);

  function handleSelectContact(phone: string) {
    setPreselectPhone(phone);
  }

  function handleSent(entry: LogData) {
    handleNewLog(entry);
  }

  function handleConfigChange() {
    setConfigVersion(v => v + 1);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>WACore <span className="subtitle">Dev UI</span></h1>
      </header>

      <ConnectionPanel onStatusChange={handleConfigChange} />

      <div className="main-grid">
        <ContactList onSelect={handleSelectContact} />
        <MessageList key={`msg-${configVersion}`} log={log} onNewLog={handleNewLog} />
        <SendMessage preselectedPhone={preselectPhone} onSent={handleSent} />
      </div>
    </div>
  );
}
