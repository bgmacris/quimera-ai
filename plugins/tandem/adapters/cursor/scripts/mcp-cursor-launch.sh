#!/usr/bin/env bash
# mcp-cursor-launch.sh — Cursor MCP entry (delegates to shared mcp-wrap.sh).
set -eu
exec "$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && cd ../../shared && pwd)/mcp-wrap.sh"   # -P: Cursor links adapters/cursor
