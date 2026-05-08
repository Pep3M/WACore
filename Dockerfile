# ============================================================
# WACore - Multi-stage Docker Build
# ============================================================
# Stage 1: Dependencies
FROM oven/bun:1 AS deps
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Stage 2: Build
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/

ENV NODE_ENV=production

# Stage 3: Runtime
FROM oven/bun:1-slim AS runtime
WORKDIR /app

RUN apt-get update -qq && apt-get install -y -qq curl --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json

RUN mkdir -p /data/sessions /data/logs && chown -R bun:bun /data /app

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:${HEALTH_PORT:-9877}/health || exit 1

EXPOSE 9877

ENTRYPOINT ["bun", "run", "src/index.ts"]
