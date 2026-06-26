#!/usr/bin/env bash
# mcp-launch.sh — command del .mcp.json. CRÍTICO: arranca en milisegundos y NO toca Chrome,
# para que el handshake `initialize` de Claude Code nunca se bloquee (si se bloquea, las tools
# se descartan en silencio toda la sesión). El MCP es LAZY: conecta al CDP en el primer uso de
# tool, no aquí. Chrome se arranca aparte con /tandem:browser-start.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
# shellcheck disable=SC1091  # source dinámico ($HERE): correcto en runtime, no resoluble estáticamente
. "$HERE/lib.sh"

# Node es prerequisito duro (el server es node). Fallar con mensaje claro, no con error críptico.
if ! command -v npx >/dev/null 2>&1; then
  echo "tandem: ERROR — Node/npx no está en PATH. Instálalo con: brew install node" >&2
  exit 127
fi

PORT="$(cdp_port)"
mkdir -p "$DATA/output"

# Versión PINEADA a propósito: @latest haría que cada arranque pudiera traer una versión
# distinta del MCP (rotura silenciosa + superficie supply-chain). Se sube de forma deliberada.
# Override con TANDEM_MCP_VERSION si quieres probar otra sin tocar el repo.
MCP_VERSION="${TANDEM_MCP_VERSION:-0.0.76}"

# Solo --cdp-endpoint (validado en PoC: sin --browser, si Chrome no está da error LIMPIO en
# vez de auto-lanzar un navegador propio). --output-dir evita ensuciar el cwd con snapshots.
exec npx -y "@playwright/mcp@${MCP_VERSION}" \
  --cdp-endpoint "http://127.0.0.1:${PORT}" \
  --output-dir "$DATA/output"
