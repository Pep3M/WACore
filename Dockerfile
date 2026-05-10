FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache curl

COPY package.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

RUN mkdir -p /data/sessions /data/logs && chown -R node:node /data /app

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:${HEALTH_PORT:-9877}/health || exit 1

EXPOSE 9877

ENTRYPOINT ["npx", "tsx", "src/index.ts"]
