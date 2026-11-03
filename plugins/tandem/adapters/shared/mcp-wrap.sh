#!/usr/bin/env bash
# mcp-wrap.sh — IDE-neutral MCP launcher: resolves TANDEM_PLUGIN_ROOT, sources tandem-env, execs upstream.
set -eu
WRAP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export TANDEM_PLUGIN_ROOT="${TANDEM_PLUGIN_ROOT:-$(cd "$WRAP/../.." && pwd)}"
if [ -f "${HOME}/.local/bin/tandem-env.sh" ]; then
  # shellcheck source=/dev/null
  . "${HOME}/.local/bin/tandem-env.sh"
fi
# Cursor/OpenCode have no PreToolUse hook to say which agent calls, so multi-session (one MCP per agent,
# each seeing only its own tabs) would leave the agent blind to the human's tabs. Default: the 0.9.x
# single MCP that sees every tab (decided 2026-11-03). TANDEM_MULTISESSION=1 (env or tandem-env) opts in.
export TANDEM_MULTISESSION="${TANDEM_MULTISESSION:-0}"
exec "${TANDEM_PLUGIN_ROOT}/scripts/mcp-launch.sh"
