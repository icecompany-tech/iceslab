# node-env.sh: how a bootstrap wires its core into the node-agent.
#
# Sourced by apps/node/scripts/bootstrap-*.sh, never run on its own.
#
# E20, stand 2026-09-24: a bootstrap put the binary on the machine and PRINTED
# the env lines the agent needs, and the agent, which reads its env and nothing
# else, went on answering "no singbox binary on this node" with sing-box in
# /usr/local/bin. The owner wrote the lines by hand on four nodes. The panel's
# "how to install" promised a working core; the command delivered half of one.
#
# So each bootstrap now writes its own block of /etc/iceslab-node/env between
# two marker lines, the same idea as the generated core-pins blocks:
#
#   # >>> iceslab-node env:<core> >>>
#   KEY=value
#   # <<< iceslab-node env:<core> <<<
#
# The rules the block keeps, all of them tested (apps/node/scripts_env_test.go):
#   - rewritten whole on every run, so two runs leave the same file;
#   - a line OUTSIDE any block that sets a key the block owns is dropped: that
#     is the hand-written copy from before, and the block is now where the key
#     lives (systemd takes the last assignment, so leaving both would make the
#     order of the file decide which one is real);
#   - everything else is left exactly where it is: NODE_PAYLOAD and the mTLS
#     material, other cores' blocks, an operator's own lines;
#   - no env file means no agent on this machine yet: the block is not written
#     and the bootstrap says so. The installer writes the file first and runs
#     the bootstraps after it.
#
# ICESLAB_NODE_ENV points the functions at another file, for the tests.

ICESLAB_NODE_ENV="${ICESLAB_NODE_ENV:-/etc/iceslab-node/env}"
NODE_ENV_RESTART_AGENT=0

# node_env_flags "$@": the flags every bootstrap takes.
#   --restart-agent  restart iceslab-node once the core is in place, so the
#                    agent reads the new block. The installer does not pass it:
#                    it starts the agent itself, once, at the end.
node_env_flags() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --restart-agent) NODE_ENV_RESTART_AGENT=1 ;;
      *) printf '[node-env] unknown flag: %s\n' "$arg" >&2; return 2 ;;
    esac
  done
}

# node_env_value KEY: the value the env file gives KEY now (its last
# assignment), empty when it gives none. For values a rerun must keep, like a
# secret the core's own config already carries.
node_env_value() {
  local key="$1"
  [[ -f "$ICESLAB_NODE_ENV" ]] || return 0
  awk -v k="$key" 'index($0, k "=") == 1 { v = substr($0, length(k) + 2) } END { printf "%s", v }' "$ICESLAB_NODE_ENV"
}

# node_env_keep KEY default: the value KEY has now, or `default` when it has
# none. What makes a second run write the same block as the first.
node_env_keep() {
  local v
  v="$(node_env_value "$1")"
  printf '%s' "${v:-$2}"
}

# node_env_block <core> KEY=value ...: write this core's block.
node_env_block() {
  local name="$1"
  shift
  local begin="# >>> iceslab-node env:${name} >>>"
  local end="# <<< iceslab-node env:${name} <<<"
  local file="$ICESLAB_NODE_ENV" line keys="" tmp

  if [[ ! -f "$file" ]]; then
    printf '[node-env] %s does not exist (no agent on this machine yet); %s not wired in, the installer will do it\n' \
      "$file" "$name" >&2
    return 0
  fi
  for line in "$@"; do
    [[ "$line" =~ ^[A-Z][A-Z0-9_]*= ]] || { printf '[node-env] not a KEY=value line: %s\n' "$line" >&2; return 2; }
    keys+="${line%%=*} "
  done

  tmp="$(mktemp "${file}.XXXXXX")"
  # Everything but this block and the loose copies of its keys. Other blocks
  # pass through untouched, loose lines included only when no block owns them.
  awk -v begin="$begin" -v end="$end" -v keys="$keys" '
    BEGIN { n = split(keys, k, " "); for (i = 1; i <= n; i++) own[k[i]] = 1 }
    $0 == begin { skip = 1; next }
    $0 == end   { skip = 0; next }
    skip        { next }
    /^# >>> iceslab-node env:/ { inother = 1 }
    /^# <<< iceslab-node env:/ { inother = 0; print; next }
    !inother && /^[A-Z][A-Z0-9_]*=/ { key = substr($0, 1, index($0, "=") - 1); if (key in own) next }
    { print }
  ' "$file" >"$tmp"
  {
    printf '%s\n' "$begin"
    printf '%s\n' "$@"
    printf '%s\n' "$end"
  } >>"$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$file"
  printf '[node-env] %s: %s written to %s\n' "$name" "${keys% }" "$file"
}

# node_env_done <core>: restart the agent if asked, or say that it is needed.
node_env_done() {
  local name="$1"
  if [[ "$NODE_ENV_RESTART_AGENT" == 1 ]]; then
    printf '[node-env] restarting iceslab-node so it picks up %s\n' "$name"
    systemctl restart iceslab-node
  elif [[ -f "$ICESLAB_NODE_ENV" ]]; then
    printf '[node-env] %s is wired in; the agent sees it after: systemctl restart iceslab-node\n' "$name"
  fi
}
