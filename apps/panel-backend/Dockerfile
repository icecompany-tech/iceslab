# syntax=docker/dockerfile:1.7

# Multi-stage Dockerfile for the Iceslab backend.
# Build context MUST be the monorepo root (so pnpm-workspace.yaml is accessible).
#
#   docker build -f apps/panel-backend/Dockerfile -t iceslab-backend .

ARG NODE_VERSION=22-alpine

# ───── Build stage ─────
FROM node:${NODE_VERSION} AS builder
# NODE_OPTIONS caps the V8 heap during build — without it pnpm + tsc can climb
# past 2 GB on a fresh install and OOM-kill the container on small VPS (CX22-class).
# 1536 MB leaves headroom for native module compilers (sharp, esbuild, prisma).
# NPM_CONFIG_FETCH_RETRIES retries silently on flaky networks instead of hanging
# forever waiting for a TCP read. Three retries with exponential backoff covers
# 95% of transient registry / mirror failures.
ENV CI=true \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--max-old-space-size=1536 \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=20000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=120000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000
RUN corepack enable
WORKDIR /repo

# Copy manifests first so dependency installation is cacheable.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/panel-backend/package.json apps/panel-backend/
COPY packages/shared/package.json packages/shared/

# Install dev+prod deps for the backend filter (incl. workspace transitives).
# --prefer-offline uses cached packages when available (faster reruns).
RUN --mount=type=cache,id=pnpm,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --prefer-offline --filter "@iceslab/panel-backend..."

# Now bring in source.
COPY apps/panel-backend apps/panel-backend
COPY packages/shared packages/shared

# Generate Prisma client + compile TS to dist/.
WORKDIR /repo/apps/panel-backend
RUN pnpm exec prisma generate
RUN pnpm exec tsc

# Strip dev deps so only production node_modules remain.
WORKDIR /repo
RUN --mount=type=cache,id=pnpm,target=/root/.pnpm-store \
    pnpm install --frozen-lockfile --prod --prefer-offline --filter "@iceslab/panel-backend..."

# ───── Runtime stage ─────
FROM node:${NODE_VERSION} AS runtime
# NODE_OPTIONS heap cap: without it, Node's auto-sizing on small-RAM containers
# (2 GB VPS) settles around a 60 MB heap, which sits at 95%+ pressure under
# normal load. GC runs every second, CPU bursts repeatedly, dashboard shows
# "panel process 96%". 512 MB is enough headroom for the panel's working set
# (Prisma client, BullMQ queues, request context) without crowding Postgres
# and Redis sharing the same 2 GB.
ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NODE_OPTIONS=--max-old-space-size=512
RUN corepack enable
# Pre-fetch pnpm so the migrate one-shot doesn't trigger an interactive
# Corepack download prompt at runtime (was hanging `pnpm exec prisma migrate
# deploy` until killed). The version comes from package.json's
# `packageManager` field.
RUN corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# Copy the trimmed workspace from the builder.
COPY --from=builder /repo /app

WORKDIR /app/apps/panel-backend
EXPOSE 3000

# Healthcheck hits /health which pings Postgres + Redis.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
