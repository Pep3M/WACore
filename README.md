# WACore

> Backend WhatsApp multicanal basado en Baileys (WebSocket, TypeScript).
> Conecta una línea de WhatsApp por proceso a servicios externos via API REST, SSE streaming o webhooks.

[![Docker Build](https://github.com/Pep3M/WACore/actions/workflows/docker-build.yml/badge.svg)](https://github.com/Pep3M/WACore/actions/workflows/docker-build.yml)
![Runtime](https://img.shields.io/badge/runtime-Bun-ff69b4)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Características

- **Conexión WhatsApp** via WebSocket (Baileys) — sin browser, sin Puppeteer, ligero
- **API REST** — enviar mensajes de texto y multimedia, consultar estado, cerrar sesión
- **Recepción en tiempo real** — SSE streaming, webhooks HTTP y polling REST
- **Persistencia de sesión** — file system, Redis o PostgreSQL (con migraciones automáticas)
- **Auto-reconexión** — backoff exponencial, no pierdes la conexión
- **Health check** — endpoint separado para orquestadores (Kubernetes, Docker)
- **Comandos extensibles** — sistema de comandos con prefijo (`!ping`, `!help`)
- **Docker** — imagen multi-stage, distroless, lista para producción
- **100% TypeScript** — tipado estricto, sin `any`

---

## Quick start

```bash
# Clonar e instalar
git clone https://github.com/Pep3M/WACore.git && cd WACore
bun install

# Configurar (mínimo: API_KEY)
cp .env.example .env
# Editar .env y poner API_KEY=mi-clave-segura

# Iniciar
bun start
```

Escanéa el código QR con WhatsApp → Ajustes > Dispositivos vinculados > Vincular un dispositivo.

Una vez conectado:

```bash
# Enviar un mensaje
curl -X POST http://localhost:9878/api/send \
  -H "Authorization: Bearer mi-clave-segura" \
  -H "Content-Type: application/json" \
  -d '{"to":"5215512345678","text":"Hola desde WACore"}'

# Ver estado
curl -H "Authorization: Bearer mi-clave-segura" http://localhost:9878/api/status
```

---

## Documentación completa

| Recurso | Descripción |
|---|---|
| [`docs/index.md`](docs/index.md) | Índice de la documentación: API, variables de entorno, Docker, ejemplos |
| [docker-compose.yml](docker-compose.yml) | Infraestructura completa con Redis y PostgreSQL |
| [.env.example](.env.example) | Todas las variables de entorno disponibles |
| [CLAUDE.md](CLAUDE.md) | Convenciones del proyecto |

---

## Docker

```bash
# Desde GitHub Container Registry
docker pull ghcr.io/pep3m/wacore:latest

docker run -d \
  --name wacore \
  -p 9877:9877 \
  -p 9878:9878 \
  -e API_KEY=mi-clave-segura \
  -e WA_INSTANCE_NAME=bot-prod \
  -v wa_sessions:/data/sessions \
  ghcr.io/pep3m/wacore:latest

# O con docker-compose (incluye PostgreSQL y Redis)
docker compose up -d
```

---

## Stack

| Componente | Tecnología |
|---|---|
| **Runtime** | [Bun](https://bun.sh) 1.2 |
| **WhatsApp** | [Baileys](https://github.com/whiskeysockets/baileys) v7 |
| **Base de datos** | File, Redis (ioredis) o PostgreSQL (Drizzle ORM) |
| **Tests** | `bun:test` — 199 tests, 0 fallos |
| **Docker** | Multi-stage, `oven/bun:1.2-slim` (~150 MB) |

---

## Variables principales

| Variable | Default | Descripción |
|---|---|---|
| `API_KEY` | — | Token de autenticación (obligatorio para la API) |
| `SESSION_STORE` | `file` | `file`, `redis` o `postgres` |
| `DATABASE_URL` | — | Conexión PostgreSQL (obligatorio si `SESSION_STORE=postgres`) |
| `SSE_ENABLED` | `true` | Streaming de mensajes en tiempo real |
| `WEBHOOK_URL` | — | URL para webhook de mensajes entrantes |

Ver todas en [docs/env-vars.md](docs/env-vars.md).

---

## Estado del proyecto

| Feature | Estado |
|---|---|
| Conexión y autenticación WhatsApp | ✅ |
| Reconexión automática con backoff | ✅ |
| Envío de mensajes (texto + multimedia) | ✅ |
| Recepción via SSE streaming | ✅ |
| Recepción via webhook | ✅ |
| Recepción via polling REST | ✅ |
| Sistema de comandos (!ping, !help) | ✅ |
| Health check endpoint | ✅ |
| Session store: file | ✅ |
| Session store: Redis | ✅ |
| Session store: PostgreSQL (auto-migraciones) | ✅ |
| Docker multi-stage (ghcr.io) | ✅ |
| CI/CD (GitHub Actions) | ✅ |

**Tests:** 199 tests, 0 fallos, 388 assertions | **TypeScript:** 0 errores

---

## Licencia

MIT
