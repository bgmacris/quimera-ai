#!/usr/bin/env bash
# e2e.sh — end-to-end with a REAL Chrome (needs a Chrome/Chromium binary; no Playwright, no display
# with TANDEM_CHROME_ARGS="--headless=new"). Exercises what smoke.sh can't: daemon start/ownership/
# stop, the HAR recorder and the intercept daemon over several tabs, cookies, pdf/png.
# Isolated: temp TANDEM_DATA_DIR, port 9333 (override TANDEM_E2E_PORT), fixture site on 8766.
# Usage: tests/e2e.sh   (exit 0 = green)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PASS=0; FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

TMP="$(mktemp -d)"
export TANDEM_DATA_DIR="$TMP/data" TANDEM_CDP_PORT="${TANDEM_E2E_PORT:-9333}"
SITE_PORT=8766; SITE="http://127.0.0.1:$SITE_PORT"
node "$HERE/fixtures/site.mjs" "$SITE_PORT" & SITE_PID=$!
cleanup() {
  "$ROOT/bin/tandem-intercept" stop >/dev/null 2>&1
  "$ROOT/scripts/chrome-daemon.sh" stop >/dev/null 2>&1
  kill "$SITE_PID" 2>/dev/null
  rm -rf -- "$TMP"
}
trap cleanup EXIT

# CDP driver without Playwright: navigate the first tab / evaluate JS in it.
cdp() { node --input-type=module -e "
import { connect, listPages } from '$ROOT/scripts/cdp.mjs';
const [pg] = await listPages(); const c = await connect(pg.webSocketDebuggerUrl);
await c.call('Page.enable');
$1
c.close();"; }
navigate() { cdp "await c.call('Page.navigate', { url: '$1' }); await new Promise((r) => setTimeout(r, 1200));"; }

echo "tandem e2e — data dir: $TANDEM_DATA_DIR · port $TANDEM_CDP_PORT"
echo "[1] daemon"
check "start" "'$ROOT/scripts/chrome-daemon.sh' start >/dev/null"
check "status: our Chrome" "'$ROOT/scripts/chrome-daemon.sh' status | grep -q '✅ active'"
check "data dir is 0700" "[ \"\$(ls -ld '$TANDEM_DATA_DIR' | cut -c1-10)\" = drwx------ ]"
check "start again is idempotent" "'$ROOT/scripts/chrome-daemon.sh' start | grep -q 'already running'"

echo "[2] recorder + intercept (all tabs)"
"$ROOT/bin/tandem-intercept" start >/dev/null
node "$ROOT/scripts/cdp-record.mjs" --out "$TMP/out.har" 2>"$TMP/rec.err" & REC=$!
for _ in $(seq 1 40); do grep -q recording "$TMP/rec.err" 2>/dev/null && break; sleep 0.25; done
navigate "$SITE/"
cdp "await c.call('Runtime.evaluate', { expression: \"document.querySelector('input').value='bob'; document.querySelector('form').submit()\" }); await new Promise((r) => setTimeout(r, 1200));"
# New tab the way a human opens one: a click (with user gesture) on a target=_blank link. A page-
# initiated navigation; a script window.open without a gesture would be popup-blocked.
navigate "$SITE/"
cdp "await c.call('Runtime.evaluate', { expression: \"document.querySelector('a[target=_blank]').click()\", userGesture: true }); await new Promise((r) => setTimeout(r, 1500));"
kill -TERM "$REC"; wait "$REC" 2>/dev/null
"$ROOT/bin/tandem-intercept" stop >/dev/null
har() { node -e "const h=JSON.parse(require('fs').readFileSync('$TMP/out.har','utf8')).log.entries;process.exit(($1)?0:1)"; }
check "HAR: POST hop is a 302 with redirectURL" "har \"h.some(e=>e.request.method==='POST'&&e.response.status===302&&/done\\\\?saved=bob/.test(e.response.redirectURL))\""
check "HAR: form body captured"                 "har \"h.some(e=>e.request.postData&&e.request.postData.text==='name=bob')\""
check "HAR: Set-Cookie of the 302 (name kept, value redacted)" "har \"h.some(e=>e.response.status===302&&e.response.cookies.some(c=>c.name==='sid'&&c.value==='[redacted]'))\""
check "HAR: JSON body of the XHR"               "har \"h.some(e=>e.request.url.endsWith('/api')&&/\\\"ok\\\":true/.test(e.response.content.text||''))\""
check "HAR: the new tab was captured"           "har \"h.some(e=>e.request.url.endsWith('/newtab'))\""
check "HAR file is 0600" "[ \"\$(ls -l '$TMP/out.har' | cut -c1-10)\" = -rw------- ]"
check "intercept: redirect hop logged"          "'$ROOT/bin/tandem-intercept' show --method POST | grep -q '302.*→.*done'"
check "intercept: new tab logged"               "'$ROOT/bin/tandem-intercept' show --url newtab | grep -q newtab"
check "intercept: no daemon left"               "'$ROOT/bin/tandem-intercept' status | grep -q 'not running'"
check "intercept log is 0600" "[ \"\$(ls -l '$TANDEM_DATA_DIR/intercept.ndjson' | cut -c1-10)\" = -rw------- ]"

echo "[3] cookies + pdf"
check "cookies: sid listed, value redacted" "'$ROOT/bin/tandem-cookies' --domain 127.0.0.1 | grep -q 'sid .*••'"
check "cookies: json needs --reveal"        "! '$ROOT/bin/tandem-cookies' --format json >/dev/null 2>&1"
PDF="$("$ROOT/bin/tandem-pdf")"
check "pdf: produced a PDF"  "case '$PDF' in pdf:*) head -c4 '${PDF#pdf:}' | grep -q '%PDF';; *) false;; esac"
PNG="$("$ROOT/bin/tandem-pdf" --png)"
# Magic bytes via node: grep does not reliably match inside a binary header (\x89PNG\r\n…).
check "png: produced a PNG"  "case '$PNG' in png:*) node -e \"process.exit(require('fs').readFileSync('${PNG#png:}').subarray(1,4).toString()==='PNG'?0:1)\";; *) false;; esac"

echo "[4] stop"
check "stop" "'$ROOT/scripts/chrome-daemon.sh' stop | grep -q stopped"
check "no Chrome left on our profile" "! pgrep -f -- '--user-data-dir=$TANDEM_DATA_DIR/chrome-profile' >/dev/null"
# Leftovers of a Chrome that ran under ANOTHER hostname (the Mac's hostname follows the network):
# start must still come up. (Headless starts even without the cleanup; the guard is for headful.)
P="$TANDEM_DATA_DIR/chrome-profile"   # the exact leftovers seen in the bench: Lock + Cookie + Socket
ln -sfn otro-host.example.net-12345 "$P/SingletonLock"; ln -sfn 12887404067409121093 "$P/SingletonCookie"
mkdir -p "$TMP/sock"; node -e "require('net').createServer().listen(process.argv[1],function(){process.exit(0)})" "$TMP/sock/SingletonSocket"
ln -sfn "$TMP/sock/SingletonSocket" "$P/SingletonSocket"   # a REAL socket file nobody listens on
check "start with a stale lock from another hostname" "'$ROOT/scripts/chrome-daemon.sh' start >/dev/null"
"$ROOT/scripts/chrome-daemon.sh" stop >/dev/null


echo "[5] external browser mode (TANDEM_BROWSER=external) — after tandem's own Chrome is gone"
CHROME="$(bash -c ". '$ROOT/scripts/lib.sh'; printf '%s' \"\$CHROME_BIN\"")"
OTHER="$TMP/other-profile"
# Used inside the strings that check() evals (not visible to the linter).
# shellcheck disable=SC2034
START_CMD="'$CHROME' ${TANDEM_CHROME_ARGS:-} --remote-debugging-port=$TANDEM_CDP_PORT --user-data-dir='$OTHER' about:blank >/dev/null 2>&1 &"
# shellcheck disable=SC2034
STOP_CMD="pkill -f -- '--user-data-dir=$OTHER'"
ext() { TANDEM_BROWSER=external TANDEM_DATA_DIR="$TMP/ext-data" "$ROOT/scripts/chrome-daemon.sh" "$@"; }
cdp_up() { curl -s --max-time 2 "http://127.0.0.1:$TANDEM_CDP_PORT/json/version" >/dev/null; }
check "external, nothing answering → start fails clearly" "! ext start >/dev/null 2>&1"
check "external + START_CMD → started and ready" "TANDEM_BROWSER_START_CMD=\"\$START_CMD\" ext start | grep -q 'external browser ready'"
check "status says external mode" "ext status | grep -q 'mode:     external'"
check "stop without STOP_CMD leaves it running" "ext stop | grep -q 'not stopping' && cdp_up"
check "stop with STOP_CMD stops it" "TANDEM_BROWSER_STOP_CMD=\"\$STOP_CMD\" ext stop | grep -q 'stopped' && sleep 1 && ! cdp_up"
pkill -f -- "--user-data-dir=$OTHER" 2>/dev/null
echo ""
echo "e2e: $PASS ok, $FAIL failures"
[ "$FAIL" -eq 0 ]
