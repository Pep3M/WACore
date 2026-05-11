# WACore — Documento de Requisitos

> **Versión:** 1.0
> **Fecha:** {DATE}
> **Estado:** Borrador
> **Proyecto:** Backend WhatsApp sobre baileys + Bun
> **Stack:** Bun + TypeScript + baileys

---

## 1. Introducción

### 1.1 Propósito del Sistema

WACore es un backend modular para automatización de WhatsApp usando la librería baileys. Proporciona una base escalable para manejar conexiones, eventos, comandos, e integración con agentes LLM.

### 1.2 Alcance del Documento

Este documento cubre los requisitos iniciales del núcleo del sistema: conexión con WhatsApp, manejo de eventos, sistema de comandos, y capa de agente LLM.

---

## 2. Requisitos Funcionales

---

### RF-01: Conexión y autenticación con WhatsApp

> **Prioridad:** CRÍTICO
> **Descripción general:** Inicializar y mantener conexión con WhatsApp Web via baileys

#### RF-01.1 — Inicialización del socket

| Campo | Descripción |
|---|---|
| **ID** | RF-01.1 |
| **Título** | Inicializar socket Baileys |
| **Descripción** | Crear y configurar makeWASocket con auth state persistente |
| **Criterios de aceptación** | • Conexión exitosa • QR visible en terminal • Reconexión automática |

---

### RF-02: Sistema de comandos

> **Prioridad:** ALTO
> **Descripción general:** Sistema extensible de comandos del bot

---### RF-06: Presence & Typing Indicator

> **Prioridad:** ALTA
> **Descripción general:** Enviar presencia (typing, recording, available) para simular interacción humana

| Subfeature | Descripción |
|---|---|
| RF-06.1 | PresenceManager service con `startTyping(jid)`, `stopTyping(jid)`, `setPresence(jid, type)` |
| RF-06.2 | API REST `POST /api/presence` (body: `{ to, type }`) |
| RF-06.3 | Auto-typing: enviar `composing` automáticamente antes de responder un mensaje |
| RF-06.4 | Tipos soportados: `composing`, `recording`, `paused`, `available`, `unavailable` |

**Criterios de aceptación:**
• Llamar a `POST /api/presence` con type=composing muestra "escribiendo..." en WhatsApp del destinatario
• Auto-typing se activa/desactiva por configuración
• Performance: sin leaks de timeouts

---

### RF-07: Recepción y descarga de medios

> **Prioridad:** ALTA
> **Descripción general:** Descargar y almacenar los medios recibidos (imagen, video, audio, documento)

| Subfeature | Descripción |
|---|---|
| RF-07.1 | MediaDownloader usando `downloadMediaMessage()` de baileys |
| RF-07.2 | MediaStore con almacenamiento en disco (configurable) |
| RF-07.3 | API REST `GET /api/media/:messageId` para recuperar el medio |
| RF-07.4 | Incluir ruta/base64 del medio en webhooks y normalized messages |

**Criterios de aceptación:**
• Al recibir una imagen, se descarga automáticamente al disco
• `GET /api/media/:id` devuelve el archivo con mimetype correcto
• Timeout y límite de tamaño configurable

---

### RF-08: Read Receipts (Confirmaciones de lectura)

> **Prioridad:** ALTA
> **Descripción general:** Marcar mensajes como leídos para actualizar los checks azules en WhatsApp

| Subfeature | Descripción |
|---|---|
| RF-08.1 | Marcar mensaje individual como leído vía `sendReceipt()` |
| RF-08.2 | API REST `POST /api/read` (body: `{ to, messageId }`) |
| RF-08.3 | Auto-read: marcar como leído automáticamente al recibir (configurable) |

**Criterios de aceptación:**
• Al enviar `POST /api/read`, el remitente ve doble check azul
• Auto-read se activa/desactiva por configuración

---

### RF-09: Reacciones a mensajes

> **Prioridad:** MEDIA
> **Descripción general:** Enviar y recibir reacciones emoji a mensajes

| Subfeature | Descripción |
|---|---|
| RF-09.1 | Send reaction vía `react` en AnyMessageContent |
| RF-09.2 | API REST `POST /api/react` (body: `{ to, messageId, emoji }`) |
| RF-09.3 | Recibir y normalizar reacciones entrantes |

**Criterios de aceptación:**
• Enviar reacción con emoji "❤️" muestra el corazón en el chat
• Enviar con emoji vacío (`""`) quita la reacción

---

### RF-10: Mensajes con quoted/reply

> **Prioridad:** MEDIA
> **Descripción general:** Enviar mensajes citando/respondiendo a un mensaje anterior

| Subfeature | Descripción |
|---|---|
| RF-10.1 | Implementar `quoted` en `sendText()` y `sendMedia()` usando `quoted` de baileys |
| RF-10.2 | API REST: aceptar `quotedMessageId` en `POST /api/send` y `POST /api/send-media` |

**Criterios de aceptación:**
• Enviar `{ text: "Hola", quotedMessageId: "xyz" }` muestra el mensaje citado
• El quoted funciona también con media

---

### RF-11: Gestión de grupos

> **Prioridad:** MEDIA
> **Descripción general:** Crear, administrar y consultar grupos de WhatsApp

| Subfeature | Descripción |
|---|---|
| RF-11.1 | `POST /api/group/create` (body: `{ subject, participants[] }`) |
| RF-11.2 | `POST /api/group/:jid/participants` (action: add/remove/kick/promote/demote) |
| RF-11.3 | `POST /api/group/:jid/settings` (announcement, locked, ephemeral) |
| RF-11.4 | `GET /api/group/:jid/metadata` — info del grupo |
| RF-11.5 | `POST /api/group/:jid/invite-code` — obtener/revocar código de invitación |

**Criterios de aceptación:**
• Crear grupo con 2+ participantes funciona
• Promover/degradar admin actualiza permisos correctamente

---

### RF-12: Envío de stickers y PTU (video note)

> **Prioridad:** MEDIA
> **Descripción general:** Soportar envío de stickers y video-notas (PTV)

| Subfeature | Descripción |
|---|---|
| RF-12.1 | Extender `SendMediaRequest.type` con `'sticker'` y `'ptv'` |
| RF-12.2 | Sticker: enviar imagen como sticker vía content `{ sticker: WAMediaUpload }` |
| RF-12.3 | PTV: enviar video como video-nota vía `{ video, ptv: true }` |

**Criterios de aceptación:**
• Enviar sticker se renderiza como sticker en WhatsApp
• Enviar PTV se reproduce como video-nota circular

---

### RF-13: Mensajes de ubicación y contacto

> **Prioridad:** BAJA
> **Descripción general:** Enviar ubicaciones geográficas y tarjetas de contacto

| Subfeature | Descripción |
|---|---|
| RF-13.1 | API REST `POST /api/send-location` (body: `{ to, latitude, longitude, name?, address? }`) |
| RF-13.2 | API REST `POST /api/send-contact` (body: `{ to, displayName, phoneNumber }`) |

**Criterios de aceptación:**
• Ubicación se muestra como mapa en WhatsApp
• Contacto se muestra como tarjeta de contacto

---

### RF-14: Encuestas (Poll messages)

> **Prioridad:** BAJA
> **Descripción general:** Crear y enviar encuestas interactivas

| Subfeature | Descripción |
|---|---|
| RF-14.1 | API REST `POST /api/send-poll` (body: `{ to, question, options[], maxAnswers? }`) |
| RF-14.2 | Soporte para múltiples respuestas opcional |

**Criterios de aceptación:**
• Encuesta se muestra correctamente en WhatsApp con opciones cliqueables
• Se puede votar y ver resultados en tiempo real

---

### RF-15: Chat Management

> **Prioridad:** BAJA
> **Descripción general:** Archivar, pin, mute y otras operaciones de chat

| Subfeature | Descripción |
|---|---|
| RF-15.1 | API REST `POST /api/chat/archive` (body: `{ jid, archive: boolean }`) |
| RF-15.2 | API REST `POST /api/chat/pin` (body: `{ jid, pin: boolean }`) |
| RF-15.3 | API REST `POST /api/chat/mute` (body: `{ jid, muteDuration }`) |

---

### RF-16: Comandos avanzados

> **Prioridad:** BAJA
> **Descripción general:** Mejoras al sistema de comandos con middlewares y permisos

| Subfeature | Descripción |
|---|---|
| RF-16.1 | Sistema de middleware (rate-limit, cooldown, permisos por usuario/grupo) |
| RF-16.2 | Argument parsing robusto (flags, quoted strings) |
| RF-16.3 | Help dinámico con categorías |

---

### RF-17: Newsletter

> **Prioridad:** BAJA
> **Descripción general:** Gestión de newsletters de WhatsApp

| Subfeature | Descripción |
|---|---|
| RF-17.1 | Crear y gestionar newsletters |
| RF-17.2 | Enviar mensajes a suscriptores |

---

### RF-18: Business Profile & Catalog

> **Prioridad:** BAJA
> **Descripción general:** Perfil de negocio y catálogo de productos (cuentas business)

| Subfeature | Descripción |
|---|---|
| RF-18.1 | Actualizar perfil de negocio (`updateBussinesProfile`) |
| RF-18.2 | Gestión de productos (crear, actualizar, eliminar) |

---

## 3. Requisitos No Funcionales

### RNF-01: Resiliencia

| Campo | Descripción |
|---|---|
| **Descripción** | El sistema debe reconectarse automáticamente ante caídas de conexión |
| **Validación** | Simular desconexión y verificar reconexión en < 30s |

---
