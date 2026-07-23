#!/usr/bin/env bash

ensure_mita_compat_path() {
  local target=${1:?target path is required}
  local installed

  if [[ -x $target ]]; then
    printf '%s\n' "$target"
    return 0
  fi

  installed=$(command -v mita 2>/dev/null || true)
  [[ -n $installed && -x $installed ]] || return 1

  mkdir -p "$(dirname "$target")"
  ln -sfn "$installed" "$target"
  printf '%s\n' "$target"
}
