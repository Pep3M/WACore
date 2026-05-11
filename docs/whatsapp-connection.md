# Conexión a WhatsApp

## Primera conexión

Al iniciar WACore, si no hay una sesión guardada, se muestra un código QR en la terminal:

```
┌──────────────────────────────┐
│  ██ ██████ ██  ██  ██ ██████ │
│  ██  ██  ████ ██████ ██  ██ │
│  ████ ██████ ██████ ████████ │
│  ██████ ██████  ██  ██  ████ │
│  ██  ██████ ██████ ██████  ██ │
└──────────────────────────────┘
Escanea el QR con WhatsApp para conectar
```

**En WhatsApp**: Abre → Ajustes (⚙️) → Dispositivos vinculados → Vincular un dispositivo → Escanea el QR.

## Reconexión automática

WACore guarda la sesión automáticamente. Al reiniciar, si hay una sesión previa válida:

- **Con `SESSION_STORE=file`**: las credenciales persisten en `SESSION_DIR` (por defecto `/data/sessions/`).
- **Con `SESSION_STORE=redis`**: persisten en Redis.
- **Con `SESSION_STORE=postgres`**: persisten en PostgreSQL (tabla `wacore_sessions`).

No es necesario escanear el QR de nuevo a menos que la sesión expire o se cierre explícitamente con `DELETE /api/session`.

## Obtener QR via API

Si no se usó `CONNECT_ON_STARTUP=true` o se perdió la sesión:

```bash
curl -H "Authorization: Bearer $API_KEY" http://localhost:9878/api/qr
```

## Manejo del QR desde un frontend

El QR de WhatsApp **se regenera periódicamente** (~cada 20 segundos) hasta que el usuario lo escanea. Si el frontend se queda con el primer QR, este quedará obsoleto y el escaneo fallará.

**Flujo correcto:**

1. Consultar `GET /api/status` hasta que `status` sea `awaiting-qr`.
2. Iniciar un **polling cada 3-5 segundos** a `GET /api/qr` para obtener el QR vigente.
3. Renderizar el QR y permitir que el usuario lo escanee.
4. Cuando el usuario escanea, el status cambia a `connected`.
5. Detener el polling al salir del estado `awaiting-qr`.

```typescript
// Ejemplo: polling de QR en React
useEffect(() => {
  if (status !== 'awaiting-qr') {
    setQr(null);
    return;
  }
  const fetchQr = () =>
    fetch('/api/qr', { headers: { Authorization } })
      .then(r => r.json())
      .then(r => { if (r.success) setQr(r.data.qr); });
  fetchQr();
  const id = setInterval(fetchQr, 5000);
  return () => clearInterval(id);
}, [status]);
```

**Evento SSE `connection`:** el backend también notifica cambios de estado via SSE. Cuando el frontend recibe un evento `connection` con `status: "awaiting-qr"`, debe disparar el polling de QR. Al recibir `status: "connected"`, debe detenerlo y limpiar el QR.
