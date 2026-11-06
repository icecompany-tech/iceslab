# syntax=docker/dockerfile:1.7

# The new panel frontend: Vite bundle served by nginx, the same runtime shape as
# apps/panel-frontend, which it replaces screen by screen.
# Build context MUST be the monorepo root (so pnpm-workspace.yaml is accessible).
#
#   docker build -f apps/panel-web/Dockerfile -t iceslab-panel-web .
#
# The nginx config reverse-proxies `/api`, the subscription prefix, `/admin` and
# `/health` to the backend service (compose service name `backend`, port 3000).

ARG NODE_VERSION=22.22-alpine
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION} AS builder
ENV CI=true \
    NODE_OPTIONS=--max-old-space-size=1536 \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/panel-web/package.json apps/panel-web/

RUN --mount=type=cache,id=pnpm,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --prefer-offline --filter "@iceslab/panel-web..."

COPY apps/panel-web apps/panel-web

WORKDIR /repo/apps/panel-web
RUN pnpm build

FROM nginx:${NGINX_VERSION} AS runtime
COPY --from=builder /repo/apps/panel-web/dist /usr/share/nginx/html
# Rendered at start by the image's own entrypoint (20-envsubst-on-templates.sh),
# so the subscription prefix is the one the operator set for the backend. The
# filter keeps envsubst off every other `$`: those are nginx variables.
ENV SUBSCRIPTION_PATH_PREFIX=/sub \
    NGINX_ENVSUBST_FILTER=^SUBSCRIPTION_PATH_PREFIX$
COPY apps/panel-web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0755 apps/panel-web/docker-entrypoint.d/15-subscription-prefix.sh /docker-entrypoint.d/
EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ > /dev/null 2>&1 || exit 1
