#!/usr/bin/env bash
# Temporary probe: main's MCP on demand on a real headful Chrome, twice.
set -u
ROOT="$PWD/plugins/tandem"; D="$ROOT/scripts/chrome-daemon.sh"
export TANDEM_DATA_DIR="$RUNNER_TEMP/tandem-lazy" TANDEM_CDP_PORT=9333 TANDEM_CDP_WAIT=60
"$D" start --no-window | tail -1
for i in 1 2; do
  node "$ROOT/tests/lazy-main-e2e.mjs" > "$RUNNER_TEMP/o.txt" 2>&1; rc=$?
  echo "PROBE run=$i exit=$rc $(grep -aE ' ok, [0-9]+ failures' "$RUNNER_TEMP/o.txt" | tail -1)"
  grep -a '✗' "$RUNNER_TEMP/o.txt" | cut -c1-300 | sed 's/^/PROBE   /'
  grep -aE 'first call:|launcher alone' "$RUNNER_TEMP/o.txt" | sed 's/^/PROBE   /'
  [ "$rc" = 0 ] || tail -n 12 "$RUNNER_TEMP/o.txt" | cut -c1-200 | sed 's/^/TAIL /'
done
"$D" stop | tail -1
