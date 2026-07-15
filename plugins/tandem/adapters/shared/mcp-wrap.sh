#!/usr/bin/env bash
# mcp-wrap.sh — IDE-neutral MCP launcher: resolves TANDEM_PLUGIN_ROOT, sources tandem-env, execs upstream.
set -eu
WRAP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export TANDEM_PLUGIN_ROOT="${TANDEM_PLUGIN_ROOT:-$(cd "$WRAP/../.." && pwd)}"
if [ -f "${HOME}/.local/bin/tandem-env.sh" ]; then
  # shellcheck source=/dev/null
  . "${HOME}/.local/bin/tandem-env.sh"
fi
exec "${TANDEM_PLUGIN_ROOT}/scripts/mcp-launch.sh"
