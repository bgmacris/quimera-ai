#!/usr/bin/env bash
# mcp-cursor-launch.sh — Cursor MCP entry (delegates to shared mcp-wrap.sh).
set -eu
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/../shared" && pwd)/mcp-wrap.sh"
