#!/usr/bin/env bash
# first-admin.sh: creates the panel's CA and its first admin from inside the
# backend container, the admin with a generated password, while the panel port is
# still closed.
# The installer runs it before it starts the frontend. By hand, on a compose
# install, run it after `up -d backend` and before the frontend is up:
#
#   ./scripts/ops/first-admin.sh
#   ./scripts/ops/first-admin.sh --compose docker-compose.ghcr.yml
#
# The route closes itself once an admin exists, so a repeat refuses, with exit
# code 3. The password goes to a mode 600 file and to the terminal itself, never
# to stdout or stderr: the install is commonly run through `tee`, and a log file
# is the last place it should land.

set -euo pipefail

LIB_PREFIX="first-admin"
# shellcheck source=_lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
ADMIN_NAME="admin"
ADMIN_FILE="${ICESLAB_FIRST_ADMIN_FILE:-/root/iceslab-first-admin.txt}"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --compose)
            COMPOSE_FILE="${2:?--compose needs a file}"
            shift 2
            ;;
        -h|--help)
            sed -n '2,13p' "$0" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            log_err "unknown arg: $1"
            exit 2
            ;;
    esac
done

require_compose_root
DC=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

# The panel CA first, by the image's own bootstrapCa, while nothing else can ask
# for it. The backend makes it lazily, check then insert, and a fresh panel's first
# node raced the node pollers for it: one of the two inserts lost, the request
# answered 500 and left a node with no payload (Бк-183). With the row in place
# every later call only reads it, so a repeat changes nothing.
ca=$("${DC[@]}" exec -T backend node -e "
const dist = require('path').join(process.cwd(), 'dist');
(async () => {
  const { prisma } = await import(dist + '/prisma.js');
  const had = await prisma.keygenCa.count();
  const { bootstrapCa } = await import(dist + '/modules/keygen/keygen.service.js');
  await bootstrapCa();
  console.log(had > 0 ? 'present' : 'created');
  await prisma.\$disconnect();
  process.exit(0);
})().catch((e) => { console.log('failed: ' + e.message); process.exit(1); });
" 2>/dev/null || true)
ca=${ca##*$'\n'}
case "$ca" in
    created) log_ok "panel CA created" ;;
    present) log_info "panel CA already there, unchanged" ;;
    *)
        log_err "the panel CA was not created: ${ca:-no answer}"
        log_err "  its log: ${DC[*]} logs --tail 30 backend"
        exit 1
        ;;
esac

# The answer into a variable first, never `| grep -q` (E33).
status=$("${DC[@]}" exec -T backend wget -qO- http://127.0.0.1:3000/api/auth/status 2>/dev/null || true)
if grep -q '"registration":{"enabled":false' <<<"$status"; then
    log_err "this panel already has an admin, nothing was changed"
    exit 3
fi
if ! grep -q '"registration":{"enabled":true' <<<"$status"; then
    log_err "the backend did not answer /api/auth/status: is it up and healthy?"
    log_err "  (try: ${DC[*]} up -d backend)"
    exit 1
fi

password=$(openssl rand -hex 24)

# Written before the request: an admin nobody knows the password of cannot be
# fixed from outside, and a file left by a refused request is removed below.
(umask 077 && printf 'username: %s\npassword: %s\n' "$ADMIN_NAME" "$password" >"$ADMIN_FILE")
chmod 600 "$ADMIN_FILE"

# Over stdin, so the password is not on a command line in the container's ps.
code=$(printf '{"username":"%s","password":"%s"}' "$ADMIN_NAME" "$password" | "${DC[@]}" exec -T backend node -e "
fetch('http://127.0.0.1:3000/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: require('fs').readFileSync(0, 'utf8'),
}).then((r) => console.log(r.status)).catch((e) => console.log(e.message));
" 2>/dev/null || true)

if [[ "$code" != "201" ]]; then
    rm -f "$ADMIN_FILE"
    log_err "the backend refused to create the first admin: ${code:-no answer}"
    log_err "  its log: ${DC[*]} logs --tail 30 backend"
    exit 1
fi

log_ok "first admin created: ${ADMIN_NAME}, password in ${ADMIN_FILE} (mode 600)"
log_info "sign in, change the password, then delete that file"
# /dev/tty and not stdout, see above. Without a terminal the file is the only copy.
{ printf '\n  Password for %s: %s\n\n' "$ADMIN_NAME" "$password" >/dev/tty; } 2>/dev/null || true
