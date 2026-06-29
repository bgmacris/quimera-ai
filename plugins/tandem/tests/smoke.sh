#!/usr/bin/env bash
# smoke.sh — smoke test for the tandem plugin, WITHOUT launching Chrome (that requires a
# display and is left as a manual test: /tandem:browser-start → status → stop). Here we
# verify what is deterministic and cheap: that scripts parse, that the tandem:map engine
# (map.sh, fingerprint.mjs, hook-inject-profile.mjs) works, and that recent hardenings hold:
#   - fingerprint rejects hosts with traversal (does not write outside sites/)
#   - map.sh index emits valid JSON even when frontmatter contains quotes
#   - hook injects once per (session,host) and stays silent when there is no profile
#
# Usage: tests/smoke.sh   (exit 0 = all green). Isolates state in a temporary TANDEM_DATA_DIR.
#
# Captures (OUT*, IDX) are consumed INSIDE the strings that check() passes to `eval`, not
# visible to the linter → false SC2034 (unused). Suppressed at file scope (must come
# before the first command to have file scope).
# shellcheck disable=SC2034
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SCRIPTS="$ROOT/scripts"

PASS=0; FAIL=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# Isolated data sandbox (removed on exit).
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tandem-smoke.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
export TANDEM_DATA_DIR="$TMP"
SITES="$TMP/sites"

echo "tandem smoke — data dir: $TMP"

# --- 1. static parsing --------------------------------------------------------------
echo "[1] static parsing"
for f in "$SCRIPTS"/*.sh "$ROOT"/bin/*; do
  check "bash -n $(basename "$f")" "bash -n '$f' 2>/dev/null"
done
for f in "$SCRIPTS"/*.mjs; do
  check "node --check $(basename "$f")" "node --check '$f' 2>/dev/null"
done
# Executable bit: everything invoked by its PATH (not with `bash`/`node` or `source`) must
# have +x, or it fails with 126 in production. lib.sh is `source`d, so it is excluded.
for f in chrome-daemon.sh map.sh mcp-launch.sh fingerprint.mjs hook-inject-profile.mjs; do
  check "$f is executable (+x)" "[ -x '$SCRIPTS/$f' ]"
done
check "bin/tandem-browser is executable (+x)" "[ -x '$ROOT/bin/tandem-browser' ]"

# --- 2. map.sh: list/show/path/index over a seeded profile --------------------------
echo "[2] map.sh"
mkdir -p "$SITES"
# Intentionally hostile frontmatter: quotes and backslash in updated, to break a hand-built
# JSON. The fix (serialize with node) must produce valid JSON regardless.
cat > "$SITES/example.com.md" <<'EOF'
---
site: example.com
updated: 2026-06-22 "weird\test"
---
# example.com
test recipe
EOF

check "list shows the site"         "'$SCRIPTS/map.sh' list   | grep -q example.com"
check "show dumps the profile"      "'$SCRIPTS/map.sh' show example.com | grep -q 'test recipe'"
check "path normalizes URL→host"    "[ \"\$('$SCRIPTS/map.sh' path https://EXAMPLE.com/x/y)\" = '$SITES/example.com.md' ]"
check "show of unknown host fails"  "! '$SCRIPTS/map.sh' show no-such-host.com 2>/dev/null"

# index: must be valid JSON even with quoted frontmatter (finding #3).
IDX="$("$SCRIPTS/map.sh" index)"
check "index is valid JSON (frontmatter with quotes)" \
  "printf '%s' \"\$IDX\" | node -e 'JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"))' 2>/dev/null"
check "index contains the host" "printf '%s' \"\$IDX\" | grep -q example.com"

# --- 3. fingerprint.mjs: capture / check / drift / traversal ------------------------
echo "[3] fingerprint.mjs"
FP="$SCRIPTS/fingerprint.mjs"
echo '["a","b","c"]' | "$FP" capture example.com /home >/dev/null 2>&1
check "capture creates the store"       "[ -f '$SITES/example.com.fingerprints.json' ]"
check "check same → status match (exit 0)" "echo '[\"a\",\"b\",\"c\"]' | '$FP' check example.com /home >/dev/null 2>&1"
check "check different → drift (exit 1)"   "! ( echo '[\"a\",\"b\",\"z\"]' | '$FP' check example.com /home >/dev/null 2>&1 )"
check "check new route → status new"       "echo '[\"x\"]' | '$FP' check example.com /other 2>/dev/null | grep -q '\"new\"'"

# Finding #2: host with traversal must be REJECTED and NOT write outside sites/.
echo '["x"]' | "$FP" capture "../../canary" /r >/dev/null 2>&1
fp_rc=$?
check "fingerprint rejects host with traversal (exit≠0)" "[ $fp_rc -ne 0 ]"
check "traversal did NOT write outside sites/"            "[ ! -e '$TMP/canary.fingerprints.json' ] && [ ! -e '${TMP%/*}/canary.fingerprints.json' ]"
check "fingerprint normalizes full URL as host"           "echo '[\"x\"]' | '$FP' capture https://EXAMPLE.com/path /r >/dev/null 2>&1"

# --- 4. hook-inject-profile.mjs: silence / injection / once-per-session -------------
echo "[4] hook-inject-profile.mjs"
HOOK="$SCRIPTS/hook-inject-profile.mjs"
SID="smoke-session"
nav() { printf '{"session_id":"%s","tool_input":{"url":"%s"}}' "$SID" "$1"; }

# host with no profile → total silence (no stdout).
OUT="$(nav 'https://no-profile.com/' | "$HOOK" 2>/dev/null)"
check "no profile → silence" "[ -z \"\$OUT\" ]"

# host with profile → first time injects additionalContext.
OUT1="$(nav 'https://example.com/' | "$HOOK" 2>/dev/null)"
check "with profile → injects additionalContext" "printf '%s' \"\$OUT1\" | grep -q additionalContext"
check "context includes the profile"             "printf '%s' \"\$OUT1\" | grep -q 'test recipe'"

# second navigation to the same host in the same session → silence (marker).
OUT2="$(nav 'https://example.com/other' | "$HOOK" 2>/dev/null)"
check "second time same session → silence" "[ -z \"\$OUT2\" ]"

# cleanup removes the marker → injects again.
printf '{"session_id":"%s"}' "$SID" | "$HOOK" cleanup >/dev/null 2>&1
OUT3="$(nav 'https://example.com/' | "$HOOK" 2>/dev/null)"
check "after cleanup → injects again" "printf '%s' \"\$OUT3\" | grep -q additionalContext"

# --- 5. fingerprint: drift engine end-to-end ----------------------------------------
# Beyond exit code: verify the JSON CONTRACT (added/removed/counts), that capture
# overwrites, that routes on the same host are independent, and that capture dedupes+sorts.
echo "[5] fingerprint — drift E2E"
fp_capture() { printf '%s' "$1" | "$FP" capture example.com "$2" 2>/dev/null; }
fp_check()   { printf '%s' "$1" | "$FP" check   example.com "$2" 2>/dev/null; }
# jassert <desc> <json> <node-expr>: evaluates expr (with parsed object in `o`) → ok/bad.
jassert() {
  if printf '%s' "$2" | node -e "const o=JSON.parse(require('fs').readFileSync(0,'utf8'));process.exit(($3)?0:1)" 2>/dev/null
  then ok "$1"; else bad "$1"; fi
}

# (a) drift: adding 'd' and removing 'c' must appear in added[]/removed[] and in counts.
fp_capture '["a","b","c"]' /e2e >/dev/null
DRIFT="$(fp_check '["a","b","d"]' /e2e)"
jassert "drift: status=drift"                  "$DRIFT" "o.status==='drift'"
jassert "drift: added=[d]"                     "$DRIFT" "o.added.join()==='d'"
jassert "drift: removed=[c]"                   "$DRIFT" "o.removed.join()==='c'"
jassert "drift: prevCount=3 nowCount=3"        "$DRIFT" "o.prevCount===3 && o.nowCount===3"
jassert "drift: captured date preserved"       "$DRIFT" "typeof o.captured==='string' && o.captured.length===10"

# (b) capture OVERWRITES the route: recapturing with a different set makes the old one stale.
fp_capture '["x","y"]' /e2e >/dev/null
jassert "after recapture: new set matches"     "$(fp_check '["x","y"]' /e2e)" "o.status==='match'"
jassert "after recapture: old set drifts"      "$(fp_check '["a","b","c"]' /e2e)" "o.status==='drift'"

# (c) routes are independent within the same host (key is routeKey, not host).
fp_capture '["p"]' /route-1 >/dev/null
fp_capture '["q"]' /route-2 >/dev/null
jassert "route-1 matches its own set"          "$(fp_check '["p"]' /route-1)" "o.status==='match'"
jassert "route-2 matches its own set"          "$(fp_check '["q"]' /route-2)" "o.status==='match'"
jassert "crossing sets between routes drifts"  "$(fp_check '["p"]' /route-2)" "o.status==='drift'"

# (d) capture normalizes: dedup + stable order (repeated/unordered signals → one set).
jassert "capture dedup: [c,b,a,b] → count 3"  "$(fp_capture '["c","b","a","b"]' /norm)" "o.count===3"
jassert "dedup/order: sorted check → match"   "$(fp_check '["a","b","c"]' /norm)" "o.status==='match'"

# NOTE: digit normalization to '#' (e.g. 'Inbox 112'→'Inbox #') is done by the
# canonical browser_evaluate in the map skill, NOT by fingerprint.mjs — here we only
# store/compare the already-normalized set. That JS is not isolatable code; it stays
# outside this smoke test.

# --- 6. page-signals.mjs: page fingerprint (dedicated JS test) ----------------------
# The norm/collectSignals logic is tested with a mock DOM in its own runner (node, no deps);
# here we invoke it and reflect its verdict in the global count.
echo "[6] page-signals.mjs (node tests/page-signals.test.mjs)"
if node "$HERE/page-signals.test.mjs" 2>&1 | sed 's/^/  /'; then
  ok "page-signals.test.mjs green"
else
  bad "page-signals.test.mjs"
fi

# --- 7. selector.mjs: Playwright selector generator (dedicated JS test) -------------
# Generates the executable `sel:` the profile stores for frugal navigation; the test covers
# escapes (quotes, regex, '/'). Invoked here, its verdict enters the global count.
echo "[7] selector.mjs (node tests/selector.test.mjs)"
if node "$HERE/selector.test.mjs" 2>&1 | sed 's/^/  /'; then
  ok "selector.test.mjs green"
else
  bad "selector.test.mjs"
fi

# --- 8. recipe.mjs: executable recipe compiler (dedicated JS test) ------------------
# Compiles profile recipes to Playwright (--fast) or steps (--step); the test covers parsing,
# validation, template filling, and INJECTION (browser_run_code_unsafe is RCE-equivalent).
echo "[8] recipe.mjs (node tests/recipe.test.mjs)"
if node "$HERE/recipe.test.mjs" 2>&1 | sed 's/^/  /'; then
  ok "recipe.test.mjs green"
else
  bad "recipe.test.mjs"
fi

# --- 9. host.mjs: single host normalization (dedicated JS test) ---------------------
# Single source that recipe/fingerprint/hook/map use for "URL or host" → store key; the test
# covers URLs/bare hosts, uppercase scheme, userinfo/port, IDN, and rejection of traversal.
echo "[9] host.mjs (node tests/host.test.mjs)"
if node "$HERE/host.test.mjs" 2>&1 | sed 's/^/  /'; then
  ok "host.test.mjs green"
else
  bad "host.test.mjs"
fi

# --- summary ------------------------------------------------------------------------
echo ""
echo "result: $PASS ok, $FAIL failures"
[ "$FAIL" -eq 0 ]
