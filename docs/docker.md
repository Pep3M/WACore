# Uso con Docker

## Desde GitHub Container Registry

```bash
docker pull ghcr.io/pep3m/wacore:latest

docker run -d \
  --name wacore \
  -p 9877:9877 \
  -p 9878:9878 \
  -e API_KEY=mi-clave-segura \
  -e WA_INSTANCE_NAME=bot-prod \
  -e SESSION_STORE=file \
  -v wa_sessions:/data/sessions \
  ghcr.io/pep3m/wacore:latest
```

> `SESSION_STORE` vale `postgres` por defecto y exige `DATABASE_URL`. Sin base de datos, indica
> `SESSION_STORE=file` como arriba: si no, el contenedor se detiene al arrancar.

## Con docker-compose (recomendado)

```yaml
# docker-compose.yml
services:
  wacore:
    image: ghcr.io/pep3m/wacore:latest
    container_name: wacore
    ports:
      - "9877:9877"   # Health check
      - "9878:9878"   # REST API
    volumes:
      - wa_sessions:/data/sessions
    environment:
      - WA_INSTANCE_NAME=bot-prod
      - API_KEY=mi-clave-segura
      - SESSION_STORE=postgres
      - DATABASE_URL=postgres://wacore:wacore@postgres:5432/wacore
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9877/health > /dev/null 2>&1 || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 3
      start_period: 10s

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: wacore
      POSTGRES_PASSWORD: wacore
      POSTGRES_DB: wacore
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U wacore"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  wa_sessions:
  pg_data:
```

> **Nota**: Las migraciones de PostgreSQL se ejecutan automáticamente al arrancar. No necesitas correr nada manualmente.
