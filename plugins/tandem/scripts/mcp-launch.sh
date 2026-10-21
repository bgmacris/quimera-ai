#!/usr/bin/env bash
# mcp-launch.sh — command from .mcp.json. CRITICAL: starts in milliseconds and does NOT touch
# Chrome, so the Claude Code `initialize` handshake is never blocked (if blocked, tools are
# silently dropped for the entire session). The MCP is LAZY: connects to CDP on first tool use,
# not here. Chrome is started separately with /tandem:browser-start.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
# shellcheck disable=SC1091  # dynamic source ($HERE): correct at runtime, not statically resolvable
. "$HERE/lib.sh"

# Node is a hard prerequisite (the server is node). Fail with a clear message, not a cryptic error.
if ! command -v npx >/dev/null 2>&1; then
  echo "tandem: ERROR — Node/npx not in PATH. Install it with: brew install node" >&2
  exit 127
fi

PORT="$(cdp_port)"
mkdir -p "$DATA/output"

# Version PINNED intentionally: @latest would mean each start could bring a different
# MCP version (silent breakage + supply-chain surface). Bumped deliberately.
# Override with TANDEM_MCP_VERSION to test another version without touching the repo.
# 0.0.79+ reconnects after Chrome is restarted (stop→start no longer fails the first call).
MCP_VERSION="${TANDEM_MCP_VERSION:-0.0.83}"

# Only --cdp-endpoint (validated in PoC: without --browser, if Chrome is not running it gives
# a CLEAN error instead of auto-launching its own browser). --output-dir avoids cluttering
# the cwd with snapshots; file writes are only allowed under it (or the MCP's
# workspace root). --file-paths absolute: tool results link files by absolute path, readable
# as-is. --no-webmcp: tools a page registers via WebMCP are untrusted input → not exposed.
#
# --output-max-size: the output dir keeps page snapshots/screenshots, which carry what the page showed
# (a teammate's held 16 snapshots with tax IDs) and grew without bound (1,155 files): the MCP evicts the
# oldest past 50 MB. --timeout-action 10000: the MCP uses ONE action timeout for clicks and screenshots;
# 5 s made 17 % of real screenshots fail "waiting for fonts". Measured: a hidden (unactionable) element
# now fails after 10.0 s; a selector that matches nothing still fails at once (resolved before waiting).
# TANDEM_MCP_ARGS: extra flags for @playwright/mcp, word-split, appended LAST so they override these
# defaults (e.g. "--timeout-action 20000 --image-responses omit"). Lives in the env, not in this file,
# so an update of the plugin does not wipe it.
extra=()
if [ -n "${TANDEM_MCP_ARGS:-}" ]; then read -r -a extra <<< "$TANDEM_MCP_ARGS"; fi
exec npx -y "@playwright/mcp@${MCP_VERSION}" \
  --cdp-endpoint "http://127.0.0.1:${PORT}" \
  --output-dir "$DATA/output" \
  --file-paths absolute \
  --no-webmcp \
  --output-max-size 52428800 \
  --timeout-action 10000 \
  ${extra[@]+"${extra[@]}"}
