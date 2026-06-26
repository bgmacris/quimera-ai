#!/usr/bin/env bash
# smoke.sh — prueba de humo del plugin tandem, SIN arrancar Chrome (eso necesita display y
# queda como prueba manual: /tandem:browser-start → status → stop). Aquí se verifica lo que es
# determinista y barato: que los scripts parsean, que el motor de tandem:map (map.sh,
# fingerprint.mjs, hook-inject-profile.mjs) funciona, y que los hardenings recientes aguantan:
#   - fingerprint rechaza hosts con traversal (no escribe fuera de sites/)
#   - map.sh index emite JSON válido aunque el frontmatter lleve comillas
#   - el hook inyecta una vez por (sesión,host) y calla cuando no hay perfil
#
# Uso: tests/smoke.sh   (exit 0 = todo verde). Aísla el estado en un TANDEM_DATA_DIR temporal.
#
# Las capturas (OUT*, IDX) se consumen DENTRO de los strings que check() pasa a `eval`, no
# visibles al linter → marca SC2034 (unused) en falso. Suprimido a nivel de archivo (debe ir
# antes del primer comando para tener ámbito-archivo).
# shellcheck disable=SC2034
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SCRIPTS="$ROOT/scripts"

PASS=0; FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# Sandbox de datos aislado (se borra al salir).
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tandem-smoke.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export TANDEM_DATA_DIR="$TMP"
SITES="$TMP/sites"

echo "tandem smoke — data dir: $TMP"

# --- 1. parseo estático -------------------------------------------------------------
echo "[1] parseo estático"
for f in "$SCRIPTS"/*.sh "$ROOT"/bin/*; do
  check "bash -n $(basename "$f")" "bash -n '$f' 2>/dev/null"
done
for f in "$SCRIPTS"/*.mjs; do
  check "node --check $(basename "$f")" "node --check '$f' 2>/dev/null"
done
# Bit ejecutable: todo lo que se invoca por su RUTA (no con `bash`/`node` ni `source`) debe
# tener +x, o falla con 126 en producción. lib.sh se hace `source`, así que queda fuera.
for f in chrome-daemon.sh map.sh mcp-launch.sh fingerprint.mjs hook-inject-profile.mjs; do
  check "$f es ejecutable (+x)" "[ -x '$SCRIPTS/$f' ]"
done
check "bin/tandem-browser es ejecutable (+x)" "[ -x '$ROOT/bin/tandem-browser' ]"

# --- 2. map.sh: list/show/path/index sobre un perfil sembrado ------------------------
echo "[2] map.sh"
mkdir -p "$SITES"
# Frontmatter HOSTIL a propósito: comillas y backslash en updated, para reventar un JSON
# construido a mano. El fix (serializar con node) debe producir JSON válido igualmente.
cat > "$SITES/ejemplo.com.md" <<'EOF'
---
site: ejemplo.com
updated: 2026-06-22 "raro\test"
---
# ejemplo.com
receta de prueba
EOF

check "list muestra el sitio"      "'$SCRIPTS/map.sh' list   | grep -q ejemplo.com"
check "show vuelca el perfil"      "'$SCRIPTS/map.sh' show ejemplo.com | grep -q 'receta de prueba'"
check "path normaliza URL→host"    "[ \"\$('$SCRIPTS/map.sh' path https://EJEMPLO.com/x/y)\" = '$SITES/ejemplo.com.md' ]"
check "show de host inexistente falla" "! '$SCRIPTS/map.sh' show no-existe.com 2>/dev/null"

# index: debe ser JSON PARSEABLE pese al frontmatter con comillas (hallazgo #3).
IDX="$("$SCRIPTS/map.sh" index)"
check "index es JSON válido (frontmatter con comillas)" \
  "printf '%s' \"\$IDX\" | node -e 'JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))' 2>/dev/null"
check "index contiene el host" "printf '%s' \"\$IDX\" | grep -q ejemplo.com"

# --- 3. fingerprint.mjs: capture / check / drift / traversal ------------------------
echo "[3] fingerprint.mjs"
FP="$SCRIPTS/fingerprint.mjs"
echo '["a","b","c"]' | "$FP" capture ejemplo.com /home >/dev/null 2>&1
check "capture crea el store" "[ -f '$SITES/ejemplo.com.fingerprints.json' ]"
check "check igual → status match (exit 0)" "echo '[\"a\",\"b\",\"c\"]' | '$FP' check ejemplo.com /home >/dev/null 2>&1"
check "check distinto → drift (exit 1)"      "! ( echo '[\"a\",\"b\",\"z\"]' | '$FP' check ejemplo.com /home >/dev/null 2>&1 )"
check "check de ruta nueva → status new"     "echo '[\"x\"]' | '$FP' check ejemplo.com /otra 2>/dev/null | grep -q '\"new\"'"

# Hallazgo #2: host con traversal debe ser RECHAZADO y NO escribir fuera de sites/.
echo '["x"]' | "$FP" capture "../../canary" /r >/dev/null 2>&1
fp_rc=$?
check "fingerprint rechaza host con traversal (exit≠0)" "[ $fp_rc -ne 0 ]"
check "traversal NO escribió fuera de sites/"           "[ ! -e '$TMP/canary.fingerprints.json' ] && [ ! -e '${TMP%/*}/canary.fingerprints.json' ]"
check "fingerprint normaliza URL entera como host"      "echo '[\"x\"]' | '$FP' capture https://EJEMPLO.com/path /r >/dev/null 2>&1"

# --- 4. hook-inject-profile.mjs: silencio / inyección / una-vez-por-sesión ----------
echo "[4] hook-inject-profile.mjs"
HOOK="$SCRIPTS/hook-inject-profile.mjs"
SID="smoke-session"
nav() { printf '{"session_id":"%s","tool_input":{"url":"%s"}}' "$SID" "$1"; }

# host sin perfil → silencio total (sin stdout).
OUT="$(nav 'https://no-perfil.com/' | "$HOOK" 2>/dev/null)"
check "sin perfil → silencio" "[ -z \"\$OUT\" ]"

# host con perfil → primera vez inyecta additionalContext.
OUT1="$(nav 'https://ejemplo.com/' | "$HOOK" 2>/dev/null)"
check "con perfil → inyecta additionalContext" "printf '%s' \"\$OUT1\" | grep -q additionalContext"
check "el contexto trae el perfil"             "printf '%s' \"\$OUT1\" | grep -q 'receta de prueba'"

# segunda navegación al mismo host en la misma sesión → silencio (marcador).
OUT2="$(nav 'https://ejemplo.com/otra' | "$HOOK" 2>/dev/null)"
check "segunda vez misma sesión → silencio" "[ -z \"\$OUT2\" ]"

# cleanup borra el marcador → vuelve a inyectar.
printf '{"session_id":"%s"}' "$SID" | "$HOOK" cleanup >/dev/null 2>&1
OUT3="$(nav 'https://ejemplo.com/' | "$HOOK" 2>/dev/null)"
check "tras cleanup → vuelve a inyectar" "printf '%s' \"\$OUT3\" | grep -q additionalContext"

# --- 5. fingerprint: motor de drift end-to-end --------------------------------------
# Más allá del exit code: se verifica el CONTRATO del JSON (added/removed/counts), que capture
# sobrescribe, que las rutas de un mismo host son independientes y que capture dedup+ordena.
echo "[5] fingerprint — drift E2E"
fp_capture() { printf '%s' "$1" | "$FP" capture ejemplo.com "$2" 2>/dev/null; }
fp_check()   { printf '%s' "$1" | "$FP" check   ejemplo.com "$2" 2>/dev/null; }
# jassert <desc> <json> <expr-node>: evalúa expr (con el objeto parseado en `o`) → ok/bad.
jassert() {
  if printf '%s' "$2" | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(($3)?0:1)" 2>/dev/null
  then ok "$1"; else bad "$1"; fi
}

# (a) drift: añadir 'd' y quitar 'c' debe reportarse en added[]/removed[] y en los counts.
fp_capture '["a","b","c"]' /e2e >/dev/null
DRIFT="$(fp_check '["a","b","d"]' /e2e)"
jassert "drift: status=drift"                 "$DRIFT" "o.status==='drift'"
jassert "drift: added=[d]"                     "$DRIFT" "o.added.join()==='d'"
jassert "drift: removed=[c]"                   "$DRIFT" "o.removed.join()==='c'"
jassert "drift: prevCount=3 nowCount=3"        "$DRIFT" "o.prevCount===3 && o.nowCount===3"
jassert "drift: conserva captured (fecha)"     "$DRIFT" "typeof o.captured==='string' && o.captured.length===10"

# (b) capture SOBRESCRIBE la ruta: recapturar con otro set deja el viejo obsoleto.
fp_capture '["x","y"]' /e2e >/dev/null
jassert "tras recapture: nuevo set hace match" "$(fp_check '["x","y"]' /e2e)" "o.status==='match'"
jassert "tras recapture: set viejo da drift"   "$(fp_check '["a","b","c"]' /e2e)" "o.status==='drift'"

# (c) rutas independientes dentro del mismo host (la clave es routeKey, no el host).
fp_capture '["p"]' /ruta-1 >/dev/null
fp_capture '["q"]' /ruta-2 >/dev/null
jassert "ruta-1 match con su propio set"       "$(fp_check '["p"]' /ruta-1)" "o.status==='match'"
jassert "ruta-2 match con su propio set"       "$(fp_check '["q"]' /ruta-2)" "o.status==='match'"
jassert "cruzar sets entre rutas da drift"     "$(fp_check '["p"]' /ruta-2)" "o.status==='drift'"

# (d) capture normaliza: dedup + orden estable (señales repetidas/desordenadas → un set).
jassert "capture dedup: [c,b,a,b] → count 3"   "$(fp_capture '["c","b","a","b"]' /norm)" "o.count===3"
jassert "dedup/orden: check ordenado → match"  "$(fp_check '["a","b","c"]' /norm)" "o.status==='match'"

# NOTA: la normalización de dígitos a '#' (p.ej. 'Bandeja 112'→'Bandeja ###') la hace el
# browser_evaluate canónico de la skill map, NO fingerprint.mjs — aquí solo se almacena/compara
# el set ya normalizado. Ese JS no es código aislado testeable; queda fuera de este smoke.

# --- 6. page-signals.mjs: fingerprint de página (test JS dedicado) ------------------
# La lógica de norm/collectSignals se prueba con DOM mock en su propio runner (node, sin deps);
# aquí se invoca y se refleja su veredicto en el conteo global.
echo "[6] page-signals.mjs (node tests/page-signals.test.mjs)"
if node "$HERE/page-signals.test.mjs" 2>&1 | sed 's/^/  /'; then
  ok "page-signals.test.mjs verde"
else
  bad "page-signals.test.mjs"
fi

# --- 7. selector.mjs: generador de selectores Playwright (test JS dedicado) ---------
# Genera el `sel:` ejecutable que el perfil guarda para la navegación frugal; el test cubre los
# escapes (comillas, regex, '/'). Se invoca aquí y su veredicto entra en el conteo global.
echo "[7] selector.mjs (node tests/selector.test.mjs)"
if node "$HERE/selector.test.mjs" 2>&1 | sed 's/^/  /'; then
  ok "selector.test.mjs verde"
else
  bad "selector.test.mjs"
fi

# --- 8. recipe.mjs: compilador de recetas ejecutables (test JS dedicado) ------------
# Compila las recetas del perfil a Playwright (--fast) o pasos (--step); el test cubre parseo,
# validación, relleno de plantilla e INYECCIÓN (browser_run_code_unsafe es RCE-equivalent).
echo "[8] recipe.mjs (node tests/recipe.test.mjs)"
if node "$HERE/recipe.test.mjs" 2>&1 | sed 's/^/  /'; then
  ok "recipe.test.mjs verde"
else
  bad "recipe.test.mjs"
fi

# --- resumen ------------------------------------------------------------------------
echo ""
echo "resultado: $PASS ok, $FAIL fallos"
[ "$FAIL" -eq 0 ]
