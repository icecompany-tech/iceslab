#!/usr/bin/env bash
# Runs once when the dev container is created. Mirrors CI so a fresh container
# can typecheck, test and run the panel right away.
set -euo pipefail

cd /workspaces/iceslab

echo "==> Activating pnpm 10.33.2 via corepack"
corepack enable
corepack prepare pnpm@10.33.2 --activate

echo "==> Installing workspace dependencies"
pnpm install --frozen-lockfile

echo "==> Generating Prisma client (clears stale-client type errors)"
( cd apps/panel-backend && pnpm exec prisma generate )

# The dev server (pnpm dev) reads the repo-root .env via --env-file. Inside the
# container the db/redis hosts are compose service names, not localhost. Only
# write a container-pointed .env if none exists, to avoid clobbering a host one.
if [ ! -f .env ]; then
  echo "==> Writing repo-root .env for the container"
  cat > .env <<'EOF'
NODE_ENV=development
APP_PORT=3000
APP_HOST=0.0.0.0

# Compose service names on the shared dev-container network.
DATABASE_URL=postgres://iceslab:iceslab_dev@postgres:5432/iceslab
REDIS_URL=redis://redis:6379

LOG_LEVEL=info
JWT_SECRET=dev-only-jwt-secret-not-for-production-0123456789

CORS_ORIGIN=http://localhost:5173
HYSTERIA_PUBLIC_PORT=443
XRAY_PUBLIC_PORT=443
XRAY_FLOW=xtls-rprx-vision
XRAY_FINGERPRINT=chrome
EOF
else
  echo "==> .env already exists, leaving it untouched."
  echo "    To run the dev SERVER in-container, make sure it uses the service names:"
  echo "      DATABASE_URL=postgres://iceslab:iceslab_dev@postgres:5432/iceslab"
  echo "      REDIS_URL=redis://redis:6379"
  echo "    (typecheck and 'prisma generate' work regardless of this.)"
fi

echo ""
echo "==> Ready. Verify with:"
echo "      pnpm --filter @iceslab/panel-backend typecheck"
