#!/usr/bin/env bash
# iceslab-backup.sh
#
# Single-file backup of the Iceslab control plane:
#   - Postgres dump  (pg_dump inside iceslab-prod-postgres, SQL)
#   - Redis dump     (BGSAVE then copy dump.rdb out of iceslab-prod-redis)
#   - .env.production (host-side, contains JWT_SECRET, POSTGRES_PASSWORD, etc)
#
# All three go into one timestamped tar.gz under the chosen path (default
# `./backups/`). With `--password <pw>` the tarball is AES-256 encrypted via
# `openssl enc`. The CA private key, JWT secret, user creds and node mTLS
# material all sit inside, so encrypt at rest for off-host storage.
#
# Usage:
#   ./scripts/iceslab-backup.sh [--out /path/to/dir] [--password <pw>]
#
# Restore with the matching iceslab-restore.sh script.

set -euo pipefail

LIB_PREFIX="backup"
# shellcheck source=_lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
trap 'on_err $LINENO' ERR

# ───── Defaults ─────
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
OUT_DIR="./backups"
PASSWORD=""

POSTGRES_CONTAINER="iceslab-prod-postgres"
REDIS_CONTAINER="iceslab-prod-redis"

# ───── Args ─────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --out)
            OUT_DIR="$2"
            shift 2
            ;;
        --password)
            PASSWORD="$2"
            shift 2
            ;;
        --compose-file)
            COMPOSE_FILE="$2"
            shift 2
            ;;
        --env-file)
            ENV_FILE="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            log_err "unknown arg: $1"
            exit 2
            ;;
    esac
done

# ───── Pre-flight ─────
require_compose_root

mkdir -p "$OUT_DIR"

# Pull POSTGRES_USER / POSTGRES_DB from the env file instead of hard-coding.
# shellcheck disable=SC1090
source <(grep -E '^(POSTGRES_USER|POSTGRES_DB)=' "$ENV_FILE")
: "${POSTGRES_USER:?missing POSTGRES_USER in $ENV_FILE}"
: "${POSTGRES_DB:?missing POSTGRES_DB in $ENV_FILE}"

# Both containers must be up. pg_dump against a stopped DB is the usual
# failure when this runs from cron the night after a deploy that stalled.
if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    log_err "container ${POSTGRES_CONTAINER} is not running"
    exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
    log_err "container ${REDIS_CONTAINER} is not running"
    exit 1
fi

# ───── Stage everything in a temp dir ─────
TS="$(date -u +%Y%m%dT%H%M%SZ)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# Re-install the ERR trap: the EXIT trap above replaced the one from _lib.
trap 'on_err $LINENO' ERR

STEP_TOTAL=4

# ───── Step 1: postgres dump ─────
step 1 "postgres pg_dump → ${STAGE}/postgres.sql"
docker exec -e PGPASSWORD -i "$POSTGRES_CONTAINER" \
    pg_dump --clean --if-exists --no-owner --no-privileges \
            -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    > "${STAGE}/postgres.sql"
log_info "  $(du -h "${STAGE}/postgres.sql" | cut -f1)"
step_done

# ───── Step 2: redis BGSAVE + copy ─────
step 2 "redis BGSAVE → ${STAGE}/redis.rdb"
docker exec "$REDIS_CONTAINER" redis-cli BGSAVE >/dev/null
# BGSAVE is async; wait for LASTSAVE to advance. This loop used to give up
# after 30s and copy whatever rdb was on disk, shipping a stale snapshot.
# Now it fails loudly instead.
prev_lastsave="$(docker exec "$REDIS_CONTAINER" redis-cli LASTSAVE)"
bgsave_ok=0
for _ in $(seq 1 30); do
    sleep 1
    cur="$(docker exec "$REDIS_CONTAINER" redis-cli LASTSAVE)"
    if [[ "$cur" != "$prev_lastsave" ]]; then
        bgsave_ok=1
        break
    fi
done
if [[ $bgsave_ok -ne 1 ]]; then
    log_err "BGSAVE did not advance LASTSAVE within 30s, backup would be stale"
    log_err "  check redis health: docker logs ${REDIS_CONTAINER} --tail=50"
    exit 1
fi
docker cp "${REDIS_CONTAINER}:/data/dump.rdb" "${STAGE}/redis.rdb"
log_info "  $(du -h "${STAGE}/redis.rdb" | cut -f1)"
step_done

# ───── Step 3: env + manifest ─────
step 3 "env file + manifest"
cp "$ENV_FILE" "${STAGE}/env"

# Manifest lets restore sanity-check what it's about to overwrite.
cat > "${STAGE}/manifest.json" <<EOF
{
  "createdAt": "${TS}",
  "compose": "${COMPOSE_FILE}",
  "envFile": "${ENV_FILE}",
  "postgresUser": "${POSTGRES_USER}",
  "postgresDb": "${POSTGRES_DB}",
  "components": ["postgres.sql", "redis.rdb", "env"]
}
EOF
step_done

# ───── Step 4: tar + optional encryption ─────
ARCHIVE="${OUT_DIR}/iceslab-backup-${TS}.tar.gz"

if [[ -n "$PASSWORD" ]]; then
    step 4 "tar + AES-256-CBC encrypt → ${ARCHIVE}.enc"
    ENCRYPTED="${ARCHIVE}.enc"
    tar -C "$STAGE" -czf - postgres.sql redis.rdb env manifest.json \
        | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
                       -pass "pass:${PASSWORD}" \
                       -out "$ENCRYPTED"
    chmod 600 "$ENCRYPTED"
    SIZE="$(du -h "$ENCRYPTED" | cut -f1)"
    step_done
    echo
    log_ok "backup complete in $(elapsed_total): ${ENCRYPTED} (${SIZE}, AES-256-CBC)"
else
    step 4 "tar → ${ARCHIVE}"
    tar -C "$STAGE" -czf "$ARCHIVE" postgres.sql redis.rdb env manifest.json
    chmod 600 "$ARCHIVE"
    SIZE="$(du -h "$ARCHIVE" | cut -f1)"
    step_done
    echo
    log_ok "backup complete in $(elapsed_total): ${ARCHIVE} (${SIZE}, unencrypted)"
    log_warn "archive contains JWT_SECRET + DB password + CA private key"
    log_warn "encrypt with --password before storing off-host"
fi
