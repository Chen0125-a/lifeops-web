# syntax=docker/dockerfile:1.7.0
FROM node:24.17.0-alpine3.23 AS builder
WORKDIR /workspace

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig*.json vite.config.ts vitest.config.ts playwright.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

FROM nginx:1.30.4-alpine3.24 AS runtime
ARG OCI_REVISION=unknown-local
ARG OCI_SOURCE=local-workspace
LABEL org.opencontainers.image.title="LifeOps Web" \
      org.opencontainers.image.description="LifeOps V1 static frontend" \
      org.opencontainers.image.version="0.1.0" \
      org.opencontainers.image.revision="$OCI_REVISION" \
      org.opencontainers.image.source="$OCI_SOURCE"

RUN rm -rf /usr/share/nginx/html/* \
    && mkdir -p /tmp/nginx/client /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi \
    && chown -R nginx:nginx /tmp/nginx /usr/share/nginx/html

COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf
COPY --chmod=0555 docker-entrypoint.sh /usr/local/bin/lifeops-entrypoint
COPY --from=builder --chown=nginx:nginx /workspace/dist /usr/share/nginx/html

USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/lifeops-entrypoint"]
