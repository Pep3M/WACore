FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache curl git

COPY package.json ./
COPY scripts/ ./scripts/
RUN npm install --omit=dev && apk del git

COPY tsconfig.json ./
COPY src/ ./src/
COPY migrations/ ./migrations/

# /data/media también: es el punto de montaje del volumen de adjuntos y si no existe en la
# imagen, Docker lo crea de root y el proceso (uid 1000) no puede escribir. Los adjuntos
# entrantes se perdían con «EACCES: permission denied».
RUN mkdir -p /data/sessions /data/logs /data/media && chown -R node:node /data /app

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -sf http://localhost:${HEALTH_PORT:-9877}/health || exit 1

EXPOSE 9877

ENTRYPOINT ["npx", "tsx", "src/index.ts"]
