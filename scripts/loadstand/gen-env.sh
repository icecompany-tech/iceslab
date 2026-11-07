#!/usr/bin/env bash
# Writes .work/b2.env for one stand. Secrets are random and stay in that file.
#   gen-env.sh [public-url]
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out="$here/.work/b2.env"
public_url=${1:-http://localhost:2680}

if [ -e "$out" ]; then
  echo "$out exists, not overwriting: the database was created with its password" >&2
  exit 1
fi

mkdir -p "$here/.work"
db_password=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
jwt_secret=$(head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')
admin_password=$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')

umask 077
cat >"$out" <<EOF
POSTGRES_USER=iceslab
POSTGRES_PASSWORD=$db_password
POSTGRES_DB=iceslab_b2
DATABASE_URL=postgres://iceslab:$db_password@postgres:5432/iceslab_b2
REDIS_URL=redis://redis:6379
JWT_SECRET=$jwt_secret
JWT_EXPIRES_IN=72h
PUBLIC_URL=$public_url
CORS_ORIGIN=$public_url
LOG_LEVEL=warn
TRUST_PROXY_HOPS=1
RATE_LIMIT_SUB_PER_MIN=100000000
RATE_LIMIT_SUB_IP_PER_MIN=100000000
FRONTEND_BIND=127.0.0.1
FRONTEND_PORT=2680
B2_ADMIN_USER=b2admin
B2_ADMIN_PASSWORD=$admin_password
EOF
echo "wrote $out"
