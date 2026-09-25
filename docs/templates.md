# Plantillas de mensajes (Templates)

WACore soporta **plantillas locales** — mensajes reutilizables con placeholders `{{variable}}` que se renderizan y envían a través de los canales estándar de Baileys.

## Limitaciones vs. WhatsApp Business Cloud API

Las "HSM Templates" oficiales de Meta (las que requieren aprobación previa en el WhatsApp Manager y se envían vía Cloud API) **no se soportan**. Baileys utiliza el protocolo WebSocket del cliente móvil de WhatsApp, que no acepta enviar `templateMessage` HSM — el tipo aparece únicamente en recepción (`MessageWithContextInfo`) y no en `AnyRegularMessageContent`. Intentar construir el protobuf manualmente resulta en mensajes descartados por WhatsApp desde 2023.

Estas plantillas locales cubren el caso de uso práctico (respuestas rápidas, saludos, mensajes con variables por contacto) sin depender de aprobación de Meta.

## Modelo

Cada plantilla vive dentro de una sesión (aislamiento por `session_id`) y tiene:

- `id` — UUID generado por el servidor.
- `name` — nombre único case-insensitive por sesión.
- `body` — texto con placeholders `{{var}}`. Se admiten `[a-zA-Z0-9_.-]` en las claves. Un mismo placeholder puede aparecer varias veces.
- `media` (opcional) — `{ type: 'image'|'video'|'document'|'audio', url, mimetype?, filename? }`. Cuando hay media, el `body` renderizado se envía como `caption`.

## Endpoints

Todos requieren autenticación (`Authorization: Bearer <API_KEY>`). La sesión se resuelve con la cabecera opcional `X-Session-Id`; sin ella se usa la sesión `WA_INSTANCE_NAME`.

### `POST /api/templates`

```json
{
  "name": "welcome",
  "body": "Hola {{nombre}}, bienvenido a {{empresa}}.",
  "media": null
}
```

Respuesta `201`: `{ "success": true, "data": <TemplatePublic> }`.
Errores: `400` (name/body faltantes o media inválido), `409` (nombre duplicado).

### `GET /api/templates`

Devuelve `{ "success": true, "data": { "templates": [...] } }` ordenado alfabéticamente por `name`.

### `GET /api/templates/:id`

Devuelve la plantilla o `404`.

### `PUT /api/templates/:id`

Cuerpo parcial:

```json
{ "name": "welcome-v2", "body": "Hola {{nombre}}", "media": null }
```

- `media` ausente → no toca la media.
- `media: null` → limpia la media.
- `media: { type, url, ... }` → reemplaza.

Errores: `400` (validación), `404` (no existe), `409` (nombre duplicado).

### `DELETE /api/templates/:id`

`204` en éxito, `404` si no existe.

### `POST /api/templates/:id/send`

```json
{
  "to": "5215512345678",
  "variables": { "nombre": "Juan", "empresa": "Acme" },
  "quotedMessageId": "3EB0ABC..."
}
```

- `variables` debe ser un objeto plano con valores string.
- `quotedMessageId` **solo se aplica a plantillas de texto**. Con media, devuelve `400` en v1.

Respuesta:

```json
{ "success": true, "data": { "id": "<messageId>", "rendered": "Hola Juan, bienvenido a Acme." } }
```

Errores:
- `400 { error: "Missing variables", missing: ["empresa"] }` si falta alguna variable referenciada por el template.
- `400 { error: "quotedMessageId is not supported for templates with media (v1)" }`.
- `404` si la plantilla no existe.

## Motor de render

Regex `/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g`. La sustitución **no es recursiva** — un valor que contenga `{{x}}` no vuelve a renderizarse. Placeholders faltantes se dejan en el texto y se listan en `missing`; el endpoint `/send` responde `400` en ese caso.

## Ejemplos

```bash
BASE=http://localhost:9878
KEY=$API_KEY

# Crear
curl -s -X POST $BASE/api/templates \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"welcome","body":"Hola {{nombre}}, bienvenido."}'

# Enviar
curl -s -X POST $BASE/api/templates/<ID>/send \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d "{\"to\":\"$PHONE\",\"variables\":{\"nombre\":\"Juan\"}}"

# Con media (image)
curl -s -X POST $BASE/api/templates \
  -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -d '{"name":"promo","body":"Oferta para {{nombre}}","media":{"type":"image","url":"https://example.com/promo.jpg"}}'
```

## Persistencia

Cuando `SESSION_STORE=postgres`, las plantillas se guardan en `wacore_templates` (migración `0004_wacore_templates.sql`). En otro caso, se usa un store in-memory por proceso (no persiste entre reinicios).
