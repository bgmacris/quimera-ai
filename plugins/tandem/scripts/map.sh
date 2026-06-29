#!/usr/bin/env bash
# map.sh — site navigation profile store (tandem:map).
# Usage: map.sh {list | show <host> | path <host> | index}
#
# Philosophy (see tandem/docs/01-navigation-memory.md):
#  - The SOURCE OF TRUTH is the sites/<host>.md files. The index is DERIVED from their
#    frontmatter, not maintained separately: a manually maintained index drifts out of
#    sync, and a map that lies is worse than no map.
#  - FIXED data path (same as lib.sh): ${CLAUDE_PLUGIN_DATA} does not expand in the
#    bash injection of slash commands. Override with TANDEM_DATA_DIR.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tandem_data_dir() { printf '%s\n' "${TANDEM_DATA_DIR:-$HOME/.claude/tandem}"; }
SITES="$(tandem_data_dir)/sites"

# normalized host — SINGLE SOURCE: host.mjs (same criteria as recipe/fingerprint/hook).
# exit≠0 + error on stderr if the host fails validation; callers propagate the failure.
norm_host() { node "$HERE/host.mjs" "$1"; }

profile_path() {
  local h; h="$(norm_host "$1")" || return 1
  printf '%s\n' "$SITES/$h.md"
}

# Read a value from YAML frontmatter (between the first pair of '---'). Usage: fm_get <file> <key>
fm_get() {
  awk -v key="$2" '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---"  { exit }
    infm {
      # key: value   (value with possible ":" is kept whole)
      if ($0 ~ "^"key":[[:space:]]*") {
        sub("^"key":[[:space:]]*", "")
        print
        exit
      }
    }
  ' "$1" 2>/dev/null
}

ensure_store() { mkdir -p "$SITES"; }

cmd_path() {
  [ -n "${1:-}" ] || { echo "usage: map.sh path <host>" >&2; return 2; }
  profile_path "$1"
}

cmd_show() {
  [ -n "${1:-}" ] || { echo "usage: map.sh show <host>" >&2; return 2; }
  local f; f="$(profile_path "$1")" || return 1
  if [ -f "$f" ]; then cat "$f"; else
    echo "map: no profile for '$(norm_host "$1")' (expected at $f)." >&2
    return 1
  fi
}

cmd_list() {
  ensure_store
  shopt -s nullglob
  local files=("$SITES"/*.md) f host upd
  if [ ${#files[@]} -eq 0 ]; then
    echo "map: no profiles yet. Create the first one with the tandem:map skill."
    return 0
  fi
  printf '%-32s %-12s %s\n' "SITE" "UPDATED" "FILE"
  for f in "${files[@]}"; do
    host="$(fm_get "$f" site)"; [ -n "$host" ] || host="$(basename "$f" .md)"
    upd="$(fm_get "$f" updated)"; [ -n "$upd" ] || upd="—"
    printf '%-32s %-12s %s\n' "$host" "$upd" "$(basename "$f")"
  done
}

# DERIVED JSON index. Always to stdout; also cached in sites/index.json (regenerable).
# Serialization done by node, NOT string concatenation: a `site:` or `updated:` with quotes
# or backslashes would break a hand-built JSON. Fields travel via stdin, one line each
# (fm_get and basename never emit newlines), and node groups them in threes and serializes safely.
cmd_index() {
  ensure_store
  shopt -s nullglob
  local files=("$SITES"/*.md) f host upd
  {
    for f in "${files[@]}"; do
      host="$(fm_get "$f" site)"; [ -n "$host" ] || host="$(basename "$f" .md)"
      upd="$(fm_get "$f" updated)"
      printf '%s\n%s\n%s\n' "$host" "$(basename "$f")" "$upd"
    done
  } | node -e '
    const raw = require("fs").readFileSync(0, "utf8");
    const lines = raw.length ? raw.replace(/\n$/, "").split("\n") : [];
    const out = [];
    for (let i = 0; i + 2 < lines.length + 1; i += 3) {
      out.push({ host: lines[i] || "", file: lines[i + 1] || "", updated: lines[i + 2] || "" });
    }
    process.stdout.write(JSON.stringify(out) + "\n");
  ' | tee "$SITES/index.json"
}

case "${1:-list}" in
  list)  cmd_list ;;
  show)  shift; cmd_show "${1:-}" ;;
  path)  shift; cmd_path "${1:-}" ;;
  index) cmd_index ;;
  *) echo "usage: $(basename "$0") {list | show <host> | path <host> | index}" >&2; exit 2 ;;
esac
