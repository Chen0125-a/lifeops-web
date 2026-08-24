# syntax=docker/dockerfile:1.7.0
FROM node:24.17.0-alpine3.23 AS dependencies
WORKDIR /workspace

COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS builder
COPY server/tsconfig.json ./tsconfig.json
COPY server/src ./src
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:24.17.0-alpine3.23 AS runtime
ARG OCI_REVISION=unknown-local
ARG OCI_SOURCE=local-workspace
LABEL org.opencontainers.image.title="LifeOps API" \
      org.opencontainers.image.description="LifeOps V1 Fastify API" \
      org.opencontainers.image.version="1.0.0" \
      org.opencontainers.image.revision="$OCI_REVISION" \
      org.opencontainers.image.source="$OCI_SOURCE"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app

RUN addgroup -S -g 10001 lifeops \
    && adduser -S -D -H -u 10001 -G lifeops lifeops

COPY --from=production-dependencies --chown=lifeops:lifeops /workspace/node_modules ./node_modules
COPY --from=builder --chown=lifeops:lifeops /workspace/dist ./dist
COPY --chown=lifeops:lifeops server/migrations ./migrations

USER lifeops
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "dist/main.js"]
