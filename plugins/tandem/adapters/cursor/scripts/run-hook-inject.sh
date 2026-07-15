#!/usr/bin/env bash
# run-hook-inject.sh — Cursor hook runner (resolves paths after symlink install).
set -eu
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "${ROOT}/hooks/inject-profile.mjs" "$@"
