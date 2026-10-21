#!/usr/bin/env bash
# run-session-hook.sh — Cursor runner for the shared-Chrome lease hook (scripts/session-hook.mjs).
set -eu
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && cd ../../.. && pwd)"   # -P: Cursor links this dir
exec node "${ROOT}/scripts/session-hook.mjs" "$@"
