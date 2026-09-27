FROM oven/bun:1.4.2-alpine AS runtime

WORKDIR /app

# curl se mantiene: los compose de los consumidores lo usan en su healthcheck.
RUN apk add --no-cache curl

# El postinstall (scripts/patch-baileys.cjs) parchea baileys: los scripts van antes del install.
COPY package.json bun.lock ./
COPY scripts/ ./scripts/
RUN bun install --frozen-lockfile --production

COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# /data/media también: es el punto de montaje del volumen de adjuntos y si no existe en la
# imagen, Docker lo crea de root y el proceso (uid 1000) no puede escribir. Los adjuntos
# entrantes se perdían con «EACCES: permission denied».
RUN mkdir -p /data/sessions /data/logs /data/media && chown -R bun:bun /data /app

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:${HEALTH_PORT:-9877}/health || exit 1

EXPOSE 9877 9878

ENTRYPOINT ["bun", "src/index.ts"]
