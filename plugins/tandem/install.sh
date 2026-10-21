#!/usr/bin/env bash
# install.sh — Install tandem adapters for Cursor, OpenCode, and CLI (Linux + macOS).
#
# Usage:
#   ./install.sh              Auto-detect IDEs + always install bin/ + tandem-env.sh
#   ./install.sh --all        Force Cursor + OpenCode adapter install
#   ./install.sh --cursor     Cursor only (+ bin/)
#   ./install.sh --opencode   OpenCode only (+ bin/)
#   ./install.sh --dry-run    Print actions without changing files
#
# Data dir: ONE store shared with Claude Code (~/.claude/tandem, override TANDEM_DATA_DIR).
# Older adapter installs used ~/.local/share/tandem: it is migrated (see migrate_legacy_data_dir).

set -eu

TANDEM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTERS="${TANDEM_ROOT}/adapters"
DATA_DIR_DEFAULT="${HOME}/.claude/tandem"
LEGACY_DATA_DIR="${HOME}/.local/share/tandem"
BIN_DIR="${HOME}/.local/bin"
ENV_FILE="${BIN_DIR}/tandem-env.sh"
DRY_RUN=0
FORCE_CURSOR=0
FORCE_OPENCODE=0

usage() {
  sed -n '2,12p' "$0"
  exit "${1:-0}"
}

log() { printf 'tandem install: %s\n' "$*"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run]'; printf ' %q' "$@"; printf '\n'
  else
    "$@"
  fi
}

link() {
  local target="$1" linkpath="$2"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] ln -sfn $target -> $linkpath"
    return
  fi
  mkdir -p "$(dirname "$linkpath")"
  if [ -e "$linkpath" ] && [ ! -L "$linkpath" ]; then
    local backup
    backup="${linkpath}.bak.$(date +%s)"
    mv "$linkpath" "$backup"
    log "moved existing ${linkpath} -> ${backup}"
  fi
  ln -sfn "$target" "$linkpath"
  log "linked $linkpath -> $target"
}

detect_wsl() {
  grep -qi microsoft /proc/version 2>/dev/null || [ -n "${WSL_DISTRO_NAME:-}" ]
}

write_env_file() {
  local template="${ADAPTERS}/shared/tandem-env.template.sh"
  local tmp
  tmp="$(mktemp)"
  sed \
    -e "s|@TANDEM_ROOT@|${TANDEM_ROOT}|g" \
    -e "s|@DATA_DIR@|${DATA_DIR_DEFAULT}|g" \
    "$template" > "$tmp"

  # Optional WSL hint (user uncomments TANDEM_CHROME_BIN if autodetect fails)
  if detect_wsl; then
    cat >> "$tmp" <<'EOF'

# WSL: if system Chrome is missing, set TANDEM_CHROME_BIN to your Chrome/Chromium path.
EOF
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] write $ENV_FILE"
    cat "$tmp"
    rm -f "$tmp"
    return
  fi
  mkdir -p "$BIN_DIR"
  install -m 755 "$tmp" "$ENV_FILE"
  rm -f "$tmp"
  log "wrote $ENV_FILE"
}

install_bin_wrappers() {
  local name
  for name in tandem-browser tandem-cookies tandem-intercept tandem-pdf; do
    local wrapper="${BIN_DIR}/${name}"
    if [ "$DRY_RUN" -eq 1 ]; then
      log "[dry-run] write wrapper $wrapper"
      continue
    fi
    mkdir -p "$BIN_DIR"
    cat > "$wrapper" <<EOF
#!/usr/bin/env bash
set -eu
# shellcheck source=/dev/null
. "${ENV_FILE}"
exec "\${TANDEM_PLUGIN_ROOT}/bin/${name}" "\$@"
EOF
    chmod +x "$wrapper"
    log "wrote $wrapper"
  done
}

install_cursor() {
  local dest="${HOME}/.cursor/plugins/local/tandem"
  link "${ADAPTERS}/cursor" "$dest"
  log "Cursor: reload window to pick up plugin (${dest})"
}

install_opencode() {
  local plugin_src="${ADAPTERS}/opencode/plugins/tandem-map-inject.ts"
  local plugin_dest="${HOME}/.config/opencode/plugins/tandem-map-inject.ts"
  link "$plugin_src" "$plugin_dest"

  local cmd_src="${ADAPTERS}/opencode/commands"
  local cmd_dest="${HOME}/.config/opencode/commands"
  if [ -d "$cmd_src" ]; then
    local f
    for f in "$cmd_src"/*.md; do
      [ -e "$f" ] || continue
      link "$f" "${cmd_dest}/$(basename "$f")"
    done
  fi

  if command -v node >/dev/null 2>&1; then
    run node "${ADAPTERS}/opencode/merge-opencode-fragment.mjs"
  else
    log "WARN: node not found — merge opencode.fragment.jsonc into ~/.config/opencode/opencode.jsonc manually"
  fi
  log "OpenCode: restart opencode to load tandem MCP + plugin"
}

should_install_cursor() {
  [ "$FORCE_CURSOR" -eq 1 ] && return 0
  [ "$FORCE_OPENCODE" -eq 1 ] && [ "$FORCE_CURSOR" -eq 0 ] && return 1
  [ -d "${HOME}/.cursor" ] && return 0
  return 1
}

should_install_opencode() {
  [ "$FORCE_OPENCODE" -eq 1 ] && return 0
  [ "$FORCE_CURSOR" -eq 1 ] && [ "$FORCE_OPENCODE" -eq 0 ] && return 1
  { [ -d "${HOME}/.config/opencode" ] || command -v opencode >/dev/null 2>&1; }
}

# Two stores on the same CDP port meant a silent wrong Chrome profile and split site memory.
#  - only the legacy dir exists → move it to the new location and leave a symlink behind;
#  - both exist → never merge profiles automatically: copy site profiles that are missing in
#    the new store (cp -n, no overwrite), keep the legacy dir, and say so.
migrate_legacy_data_dir() {
  [ -d "$LEGACY_DATA_DIR" ] && [ ! -L "$LEGACY_DATA_DIR" ] || return 0
  if [ ! -e "$DATA_DIR_DEFAULT" ]; then
    run mkdir -p "$(dirname "$DATA_DIR_DEFAULT")"
    run mv "$LEGACY_DATA_DIR" "$DATA_DIR_DEFAULT"
    link "$DATA_DIR_DEFAULT" "$LEGACY_DATA_DIR"
    log "migrated $LEGACY_DATA_DIR -> $DATA_DIR_DEFAULT"
    return 0
  fi
  if [ -d "$LEGACY_DATA_DIR/sites" ]; then
    run mkdir -p "$DATA_DIR_DEFAULT/sites"
    run cp -n "$LEGACY_DATA_DIR"/sites/*.md "$DATA_DIR_DEFAULT/sites/" 2>/dev/null || true
  fi
  log "WARN: both $LEGACY_DATA_DIR and $DATA_DIR_DEFAULT exist — copied missing site profiles,"
  log "      left the legacy dir (and its Chrome profile) untouched. Remove it when you're done."
}

prepare_data_dir() {
  migrate_legacy_data_dir
  run mkdir -p "${DATA_DIR_DEFAULT}/sites" "${DATA_DIR_DEFAULT}/output" "${DATA_DIR_DEFAULT}/logs"
  run chmod 700 "$DATA_DIR_DEFAULT"
  # Legacy symlink for tools expecting ~/.cursor/tandem — only where Cursor is (linking it created
  # ~/.cursor, and then should_install_cursor saw it and installed the adapter on Cursor-less machines).
  [ -d "${HOME}/.cursor" ] || return 0
  if [ ! -e "${HOME}/.cursor/tandem" ] || [ -L "${HOME}/.cursor/tandem" ]; then
    link "$DATA_DIR_DEFAULT" "${HOME}/.cursor/tandem"
  fi
}

main() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --all) FORCE_CURSOR=1; FORCE_OPENCODE=1 ;;
      --cursor) FORCE_CURSOR=1; FORCE_OPENCODE=0 ;;
      --opencode) FORCE_OPENCODE=1; FORCE_CURSOR=0 ;;
      --dry-run) DRY_RUN=1 ;;
      -h|--help) usage 0 ;;
      *) log "unknown option: $1"; usage 1 ;;
    esac
    shift
  done

  log "tandem root: ${TANDEM_ROOT}"
  # Detect the IDEs before writing anything under $HOME.
  local want_cursor=0 want_opencode=0
  should_install_cursor && want_cursor=1
  should_install_opencode && want_opencode=1
  prepare_data_dir
  write_env_file
  install_bin_wrappers

  if [ "$want_cursor" -eq 1 ]; then
    install_cursor
  else
    log "skip Cursor (not detected; use --cursor)"
  fi

  if [ "$want_opencode" -eq 1 ]; then
    install_opencode
  else
    log "skip OpenCode (not detected; use --opencode)"
  fi

  if [ -d "${HOME}/.claude" ]; then
    log "Claude Code: use marketplace /plugin install tandem@quimera-ai (upstream hooks built-in)"
  fi

  log "done — ensure ${BIN_DIR} is in PATH"
}

main "$@"
