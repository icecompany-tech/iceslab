#!/usr/bin/env bash
# Runs once when the dev container is created. Mirrors the CI setup so a fresh
# container is immediately able to typecheck, test and run the panel.
set -euo pipefail

cd /workspaces/iceslab

echo "==> Activating pnpm 10.33.2 via corepack"
corepack enable
corepack prepare pnpm@10.33.2 --activate

echo "==> Installing workspace dependencies"
pnpm install --frozen-lockfile

echo "==> Generating Prisma client (this is what fixes the 'stale client' type errors)"
( cd apps/panel-backend && pnpm exec prisma generate )

# The dev SERVER (pnpm dev) reads the repo-root .env via --env-file. Inside the
# container the database/redis hosts are compose service names, not localhost.
# Create a container-pointed .env only if one does not already exist, so we
# never clobber a host .env the operator is keeping.
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
  echo "==> .env already exists - leaving it untouched."
  echo "    To run the dev SERVER in-container, make sure it uses the service names:"
  echo "      DATABASE_URL=postgres://iceslab:iceslab_dev@postgres:5432/iceslab"
  echo "      REDIS_URL=redis://redis:6379"
  echo "    (typecheck and 'prisma generate' work regardless of this.)"
fi

echo ""
echo "==> Ready. Verify with:"
echo "      pnpm --filter @iceslab/panel-backend typecheck"
