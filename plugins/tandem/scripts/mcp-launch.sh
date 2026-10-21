#!/usr/bin/env bash
# mcp-launch.sh — compatibility wrapper: the MCP launcher is scripts/mcp-launch.mjs (node, so it also
# runs on Windows). Kept for callers that exec this path (the Cursor/OpenCode adapters' mcp-wrap.sh).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "tandem: ERROR — Node not in PATH (Node 22+ required)." >&2
  exit 127
fi
exec node "$HERE/mcp-launch.mjs" "$@"
