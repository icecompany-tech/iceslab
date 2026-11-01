#!/usr/bin/env bash
# iceslab-restore.sh
#
# Restore a tarball produced by iceslab-backup.sh:
#   1. Decrypt (if `--password` given) and unpack the archive.
#   2. Read manifest.json, print a summary, ask the user to confirm.
#   3. Stop the panel services so nothing writes during restore.
#   4. Drop + recreate the postgres database, then `psql` the dump.
#   5. Stop redis, replace dump.rdb on its volume, restart redis.
#   6. Replace the host .env.production (only if the archive's was preserved).
#   7. Start the panel back up.
#
# DESTRUCTIVE: overwrites the database and redis state. Take a fresh
# `iceslab-backup.sh` of the current host first.
#
# Usage:
#   ./scripts/iceslab-restore.sh ./backups/iceslab-backup-...tar.gz \
#       [--password <pw>] [--yes]

set -euo pipefail

LIB_PREFIX="restore"
# shellcheck source=_lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
trap 'on_err $LINENO' ERR

# ───── Defaults ─────
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
PASSWORD=""
ASSUME_YES=0
ARCHIVE=""

POSTGRES_CONTAINER="iceslab-prod-postgres"
REDIS_CONTAINER="iceslab-prod-redis"

# ───── Args ─────
while [[ $# -gt 0 ]]; do
    case "$1" in
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
        --yes|-y)
            ASSUME_YES=1
            shift
            ;;
        -h|--help)
            sed -n '2,18p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            if [[ -z "$ARCHIVE" ]]; then
                ARCHIVE="$1"
                shift
            else
                log_err "unknown arg: $1"
                exit 2
            fi
            ;;
    esac
done

if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
    log_err "usage: $0 <archive.tar.gz[.enc]> [--password <pw>] [--yes]"
    exit 1
fi
require_compose_root

DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# ───── Stage ─────
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
# Re-install ERR trap: the EXIT trap above replaced the one set by _lib.
trap 'on_err $LINENO' ERR

STEP_TOTAL=5

# ───── Step 1: unpack ─────
step 1 "unpack archive"
if [[ "$ARCHIVE" == *.enc ]]; then
    if [[ -z "$PASSWORD" ]]; then
        log_err "archive is encrypted but --password was not given"
        exit 1
    fi
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
                 -pass "pass:${PASSWORD}" \
                 -in "$ARCHIVE" \
        | tar -C "$STAGE" -xzf -
else
    tar -C "$STAGE" -xzf "$ARCHIVE"
fi

if [[ ! -f "${STAGE}/manifest.json" ]]; then
    log_err "archive missing manifest.json, not produced by iceslab-backup.sh?"
    exit 1
fi
# The dump is checked here, before the first destructive command: step 3 drops
# the schema first and only then reads the file, so an archive without it used
# to leave an empty database (A-015).
if [[ ! -s "${STAGE}/postgres.sql" ]]; then
    log_err "archive has no postgres.sql or it is empty, nothing was changed"
    exit 1
fi
# The same for redis' snapshot: without it the restore used to load the
# database, stop the panel and die at step 4 (A-012).
if [[ ! -s "${STAGE}/redis.rdb" ]]; then
    log_err "archive has no redis.rdb or it is empty, nothing was changed"
    exit 1
fi
step_done

log_info "manifest:"
cat "${STAGE}/manifest.json"
echo

if [[ $ASSUME_YES -ne 1 ]]; then
    printf '%b[%s]%b %bthis WILL drop and recreate the live database.%b continue? (yes/no) ' \
        "$C_INFO" "$LIB_PREFIX" "$C_RST" "$C_WARN" "$C_RST"
    read -r ans
    if [[ "$ans" != "yes" ]]; then
        log_warn "aborted by operator"
        exit 1
    fi
fi

# Pull POSTGRES_USER / POSTGRES_DB from the host env file (the live target,
# not the archive's copy, see the `env` step below).
# shellcheck disable=SC1090
source <(grep -E '^(POSTGRES_USER|POSTGRES_DB)=' "$ENV_FILE")
: "${POSTGRES_USER:?missing POSTGRES_USER in $ENV_FILE}"
: "${POSTGRES_DB:?missing POSTGRES_DB in $ENV_FILE}"

# ───── Step 2: stop panel services ─────
# Service names are `backend` and `frontend`, not the container_names
# iceslab-prod-backend / iceslab-prod-frontend. The restore goes on only with
# both services in the compose file and neither running after the stop, so the
# database is dropped with nothing writing to it (A-013). The names are checked
# first because `docker compose stop` exits 0 for a service the file does not
# have (Docker Compose v5.4.0, 31.10): a stop alone proves nothing.
step 2 "stop panel services (backend, frontend)"
services="$("${DC[@]}" config --services)"
for svc in backend frontend; do
    if ! grep -qxF "$svc" <<<"$services"; then
        log_err "$COMPOSE_FILE has no service '$svc' (it has: ${services//$'\n'/, }); nothing was changed"
        exit 1
    fi
done
"${DC[@]}" stop backend frontend
running="$("${DC[@]}" ps --status running --services)"
for svc in backend frontend; do
    if grep -qxF "$svc" <<<"$running"; then
        log_err "'$svc' is still running after the stop; nothing was changed"
        exit 1
    fi
done
step_done

# ───── Step 3: postgres restore ─────
step 3 "restore postgres dump"
# DROP SCHEMA + CREATE before loading. pg_dump --clean --if-exists already
# drops each table, but a full schema reset also clears orphan objects left
# from a previous database.
docker exec -i "$POSTGRES_CONTAINER" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null

docker exec -i "$POSTGRES_CONTAINER" \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
    < "${STAGE}/postgres.sql" >/dev/null
step_done

# ───── Step 4: redis restore ─────
step 4 "restore redis snapshot"
"${DC[@]}" stop redis
# Copy into the stopped container. `docker cp` to a running redis with AOF
# active produces a corrupt rdb on next start.
docker cp "${STAGE}/redis.rdb" "${REDIS_CONTAINER}:/data/dump.rdb"
# AOF is the source of truth in our config (--appendonly yes): redis loads it
# and never reads dump.rdb, and with the AOF removed it starts EMPTY (checked
# on redis:7-alpine, 31.10). So the AOF is rebuilt from the snapshot, by redis
# itself, in a throwaway container on the stopped redis' volumes: started with
# the AOF off it loads dump.rdb, `CONFIG SET appendonly yes` writes a new AOF
# from that data, and the shutdown leaves it on the volume. Until A-012 this
# was a `docker exec` into the stopped container under `|| true`: it never
# ran, and redis came back with the state the restore was meant to replace.
rebuild_redis_aof() {
    local image name="iceslab-restore-redis" i
    # A run cut short before can leave the throwaway container behind, and its
    # name would then be taken.
    docker rm -f "$name" >/dev/null 2>&1 || true
    image="$(docker inspect --format '{{.Config.Image}}' "$REDIS_CONTAINER")"
    docker run --rm --volumes-from "$REDIS_CONTAINER" "$image" rm -rf /data/appendonlydir
    docker run -d --rm --name "$name" --volumes-from "$REDIS_CONTAINER" "$image" \
        redis-server --dir /data --dbfilename dump.rdb --appendonly no >/dev/null
    # PONG, not just an answer: while a large dump loads, ping answers LOADING.
    for i in $(seq 1 30); do
        [[ "$(docker exec "$name" redis-cli ping 2>/dev/null)" == PONG ]] && break
        (( i == 30 )) && { docker rm -f "$name" >/dev/null 2>&1; log_err "the snapshot did not load in a throwaway redis; redis is left stopped"; return 1; }
        sleep 1
    done
    docker exec "$name" redis-cli CONFIG SET appendonly yes >/dev/null
    for i in $(seq 1 60); do
        local info
        info="$(docker exec "$name" redis-cli INFO persistence)"
        if grep -q '^aof_rewrite_in_progress:0' <<<"$info" &&
           grep -q '^aof_rewrite_scheduled:0' <<<"$info" &&
           grep -q '^aof_enabled:1' <<<"$info"; then
            break
        fi
        (( i == 60 )) && { docker rm -f "$name" >/dev/null 2>&1; log_err "the AOF was not rebuilt from the snapshot; redis is left stopped"; return 1; }
        sleep 1
    done
    docker exec "$name" redis-cli SHUTDOWN >/dev/null 2>&1 || true
    for i in $(seq 1 30); do
        docker inspect "$name" >/dev/null 2>&1 || return 0
        sleep 1
    done
    docker rm -f "$name" >/dev/null 2>&1
}
rebuild_redis_aof || exit 1
"${DC[@]}" start redis
step_done

# ───── Step 5: bring panel back up ─────
step 5 "start panel services (backend, frontend)"
"${DC[@]}" start backend frontend
step_done

# The archive's env is kept beside ${ENV_FILE}, mode 600: the stage is removed
# on exit, and the path printed before A-014 pointed into it. Not beside the
# archive: that copy holds the panel's secrets in the clear, the backup is
# encrypted for them, and backup directories get synced off the host. Beside
# the live env file the same secrets already lie open, so no new place gets
# them.
ARCHIVE_ENV="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE").from-backup-$(basename "${ARCHIVE%.enc}" .tar.gz)"
if [[ -f "${STAGE}/env" ]]; then
    install -m 0600 "${STAGE}/env" "$ARCHIVE_ENV"
fi

echo
log_ok "restore complete in $(elapsed_total)"
if [[ -f "${STAGE}/env" ]]; then
    log_warn "${ENV_FILE} was NOT overwritten; the archive's copy is ${ARCHIVE_ENV}"
    log_warn "  compare the two and merge any drifted values by hand"
else
    log_warn "${ENV_FILE} was NOT overwritten, and the archive holds no env file"
fi
