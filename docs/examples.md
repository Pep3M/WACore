# Ejemplos de uso

## Echo: responder con el mismo mensaje

Usando SSE + REST API desde un script externo:

```javascript
// echo.js — recibe mensajes y responde con eco
const API = 'http://localhost:9878';
const KEY = 'mi-api-key';

async function main() {
  const response = await fetch(`${API}/api/messages/stream?types=text`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('ping')) {
        const msg = JSON.parse(line.slice(6));
        // El stream también emite presence, message.status y call: quedarse solo con texto
        if (msg.type !== 'text') continue;

        // Responder con el mismo mensaje (eco)
        await fetch(`${API}/api/send`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            to: msg.from,
            text: `Echo: ${msg.body || '(sin texto)'}`,
          }),
        });

        console.log(`Respondido a ${msg.pushName}: ${msg.body}`);
      }
    }
  }
}

main().catch(console.error);
```

```bash
bun run echo.js
```

## Guardar contacto automáticamente

Cuando alguien escribe por primera vez, se registra su número:

```javascript
// contacts.js
const API = 'http://localhost:9878';
const KEY = 'mi-api-key';
const seen = new Set();

async function main() {
  const response = await fetch(`${API}/api/messages/stream?types=text,image`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('ping')) {
        const msg = JSON.parse(line.slice(6));
        if (!msg.phone) continue; // ignora presence, message.status y call

        if (!seen.has(msg.phone) && !msg.isGroup) {
          seen.add(msg.phone);
          console.log(`Nuevo contacto: ${msg.pushName} (${msg.phone})`);
          // Aquí podrías guardar en tu propia base de datos
        }
      }
    }
  }
}

main().catch(console.error);
```

## Enviar mensaje desde otro servicio

```python
import requests

API = "http://localhost:9878"
KEY = "mi-api-key"

# Enviar texto
resp = requests.post(
    f"{API}/api/send",
    headers={"Authorization": f"Bearer {KEY}"},
    json={"to": "5215512345678", "text": "Hola desde Python"}
)
print(resp.json())

# Verificar estado
status = requests.get(
    f"{API}/api/status",
    headers={"Authorization": f"Bearer {KEY}"}
)
print(status.json()["data"])
```
