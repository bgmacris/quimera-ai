#!/usr/bin/env bash
# run-session-hook.sh — Cursor runner for the shared-Chrome lease hook (scripts/session-hook.mjs).
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
exec node "${ROOT}/scripts/session-hook.mjs" "$@"
