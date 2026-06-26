#!/usr/bin/env bash
# map.sh — store de perfiles de navegación por sitio (tandem:map).
# Uso: map.sh {list | show <host> | path <host> | index}
#
# Filosofía (ver tandem/docs/01-memoria-de-navegacion.md):
#  - La FUENTE DE VERDAD son los ficheros sites/<host>.md. El índice se DERIVA de su
#    frontmatter, no se mantiene aparte: un índice mantenido a mano se desincroniza, y
#    un mapa que miente es peor que no tener mapa.
#  - Ruta de datos FIJA (igual que lib.sh): ${CLAUDE_PLUGIN_DATA} no se expande en la
#    inyección bash de los slash commands. Override con TANDEM_DATA_DIR.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tandem_data_dir() { printf '%s\n' "${TANDEM_DATA_DIR:-$HOME/.claude/tandem}"; }
SITES="$(tandem_data_dir)/sites"

# host normalizado — FUENTE ÚNICA: host.mjs (mismo criterio que recipe/fingerprint/hook).
# exit≠0 + error en stderr si el host no valida; los llamadores propagan el fallo.
norm_host() { node "$HERE/host.mjs" "$1"; }

profile_path() {
  local h; h="$(norm_host "$1")" || return 1
  printf '%s\n' "$SITES/$h.md"
}

# Lee un valor del frontmatter YAML (entre el primer par de '---'). Uso: fm_get <file> <clave>
fm_get() {
  awk -v key="$2" '
    NR==1 && $0=="---" { infm=1; next }
    infm && $0=="---"  { exit }
    infm {
      # clave: valor   (valor con posibles ":" se conserva entero)
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
  [ -n "${1:-}" ] || { echo "uso: map.sh path <host>" >&2; return 2; }
  profile_path "$1"
}

cmd_show() {
  [ -n "${1:-}" ] || { echo "uso: map.sh show <host>" >&2; return 2; }
  local f; f="$(profile_path "$1")" || return 1
  if [ -f "$f" ]; then cat "$f"; else
    echo "map: no hay perfil para '$(norm_host "$1")' (esperado en $f)." >&2
    return 1
  fi
}

cmd_list() {
  ensure_store
  shopt -s nullglob
  local files=("$SITES"/*.md) f host upd
  if [ ${#files[@]} -eq 0 ]; then
    echo "map: sin perfiles todavía. Crea el primero con la skill tandem:map."
    return 0
  fi
  printf '%-32s %-12s %s\n' "SITIO" "ACTUALIZADO" "FICHERO"
  for f in "${files[@]}"; do
    host="$(fm_get "$f" site)"; [ -n "$host" ] || host="$(basename "$f" .md)"
    upd="$(fm_get "$f" updated)"; [ -n "$upd" ] || upd="—"
    printf '%-32s %-12s %s\n' "$host" "$upd" "$(basename "$f")"
  done
}

# Índice JSON DERIVADO. A stdout siempre; además se cachea en sites/index.json (regenerable).
# La serialización la hace node, NO concatenación de strings: un `site:`/`updated:` con comillas
# o backslash rompería un JSON hecho a mano. Los campos viajan por stdin, una línea cada uno
# (fm_get y basename nunca emiten newlines), y node los agrupa de 3 en 3 y serializa seguro.
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
  *) echo "uso: $(basename "$0") {list | show <host> | path <host> | index}" >&2; exit 2 ;;
esac
