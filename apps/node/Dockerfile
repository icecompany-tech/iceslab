# syntax=docker/dockerfile:1.7

# Multi-stage Dockerfile for the Iceslab Go node-agent.
# Build context can be the apps/node/ directory or the monorepo root —
# we copy go.mod first then the source.
#
#   docker build -f apps/node/Dockerfile -t iceslab-node apps/node
#
# Runtime is `distroless/static:nonroot` — no shell, no package manager,
# minimal attack surface. The Go binary is fully static (CGO_ENABLED=0).

ARG GO_VERSION=1.22-alpine
ARG DISTROLESS_VERSION=nonroot

# ───── Build stage ─────
FROM golang:${GO_VERSION} AS builder
WORKDIR /src

# Cache go modules separately from source.
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

# Static binary, stripped, no symbols/DWARF.
RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg/mod \
    CGO_ENABLED=0 GOOS=linux go build \
        -trimpath \
        -ldflags="-s -w" \
        -o /out/iceslab-node \
        .

# ───── Runtime stage: distroless ─────
FROM gcr.io/distroless/static:${DISTROLESS_VERSION}

COPY --from=builder /out/iceslab-node /usr/local/bin/iceslab-node

ENV NODE_HOST=0.0.0.0
ENV NODE_PORT=1337
ENV HYSTERIA_AUTH_HOST=127.0.0.1
ENV HYSTERIA_AUTH_PORT=9000

EXPOSE 1337
USER nonroot:nonroot

ENTRYPOINT ["/usr/local/bin/iceslab-node"]
