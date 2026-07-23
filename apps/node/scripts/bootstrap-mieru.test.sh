#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib/mita-path.sh
source "$SCRIPT_DIR/lib/mita-path.sh"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$TMPDIR/usr/bin" "$TMPDIR/usr/local/bin"
cat > "$TMPDIR/usr/bin/mita" <<'EOF'
#!/usr/bin/env bash
[[ ${1:-} == version ]] && printf '%s\n' '3.34.1'
EOF
chmod +x "$TMPDIR/usr/bin/mita"

PATH="$TMPDIR/usr/bin:$PATH"
TARGET="$TMPDIR/usr/local/bin/mita"
RESOLVED=$(ensure_mita_compat_path "$TARGET")

[[ $RESOLVED == "$TARGET" ]]
[[ -L $TARGET ]]
[[ $(readlink "$TARGET") == "$TMPDIR/usr/bin/mita" ]]
[[ $("$RESOLVED" version) == '3.34.1' ]]

printf '%s\n' 'bootstrap-mieru path test: PASS'
