# Recepción de mensajes

WACore ofrece tres mecanismos para recibir mensajes entrantes de WhatsApp. Puedes usar uno o varios simultáneamente.

> **Importante — `from` vs `phone`**: Cada mensaje incluye dos campos para identificar al remitente:
> - **`from`**: JID completo (ej: `5215512345678@s.whatsapp.net`). Úsalo **siempre** como valor de `to` al enviar una respuesta mediante `POST /api/send`.
> - **`phone`**: Solo el número (ej: `5215512345678`). Sirve para identificar contactos en tu UI o base de datos, **no** para responder.
>
> WACore resuelve internamente cualquier formato de JID (incluyendo LIDs de WhatsApp), por lo que `from` siempre contiene un JID de número telefónico válido al que se puede responder directamente.

## SSE (tiempo real)

Recomendado para servicios que necesitan recibir mensajes al instante. El servidor empuja los eventos al cliente a través de una conexión HTTP larga.

```javascript
// Ejemplo con JavaScript (Node.js, Bun, navegador)
const events = new EventSource(
  'http://localhost:9878/api/messages/stream?types=text,image',
  { headers: { Authorization: 'Bearer mi-api-key' } }
);

events.addEventListener('message.text', (event) => {
  const msg = JSON.parse(event.data);
  console.log(`${msg.pushName}: ${msg.body}`);

  // Responder automáticamente
  if (msg.body === '!ping') {
    fetch('http://localhost:9878/api/send', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer mi-api-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to: msg.from, text: 'Pong!' }),
    });
  }
});
```

**Ventajas:**
- Tiempo real, sin polling.
- Bajo overhead (una conexión TCP persistente).
- Filtros del lado del servidor (`types`, `phone`, `includeGroups`).

## Webhook

WACore hace un POST HTTP a una URL configurada por cada mensaje entrante. Ideal para integrar con servicios externos (n8n, Zapier, Make, tu propia API).

Configuración mínima:

```env
WEBHOOK_URL=https://mi-servicio.com/webhook/whatsapp
WEBHOOK_SECRET=mi-clave-hmac
WEBHOOK_EVENTS=message,connection,qr
```

Payload que recibe el webhook:

```json
{
  "event": "message",
  "instanceId": "bot-prod",
  "timestamp": "2025-05-08T12:00:00.000Z",
  "data": {
    "id": "3EB0C25E6A...",
    "from": "5215512345678@s.whatsapp.net",
    "phone": "5215512345678",
    "pushName": "Juan",
    "type": "text",
    "body": "Hola",
    "isGroup": false,
    ...
  }
}
```

Headers adicionales:
- `X-WACore-Event: message`
- `X-WACore-Instance: bot-prod`
- `X-WACore-Timestamp: 2025-05-08T12:00:00.000Z`
- `X-WACore-Signature: <hmac-sha256>` (si se configuró `WEBHOOK_SECRET`)

> Incluye circuit breaker: tras fallos consecutivos, deja de intentar y se restablece automáticamente tras un tiempo de espera.

## Polling

Para sistemas simples que prefieren consultar mensajes bajo demanda.

```bash
# Cada N segundos, preguntar por mensajes nuevos
SINCE="2025-05-08T12:00:00Z"
while true; do
  RESP=$(curl -s -H "Authorization: Bearer $API_KEY" \
    "http://localhost:9878/api/messages?since=$SINCE&limit=10")
  echo "$RESP" | jq -c '.data.messages[] | {from: .phone, body: .body}'
  SINCE=$(echo "$RESP" | jq -r '.data.cursor // $SINCE')
  sleep 3
done
```

Ver la sección [`GET /api/messages`](api-rest.md#get-apimessages--polling-de-mensajes-entrantes) para detalle del formato.
