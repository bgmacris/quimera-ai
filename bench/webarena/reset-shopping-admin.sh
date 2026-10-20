#!/usr/bin/env bash
# reset-shopping-admin.sh — clean state for the next task: recreate the container from the image.
# The published image's env-ctrl has no /reset (routes: /status /is_ready /init /start /stop /restart,
# verified 2026-10-20), so a fresh container is the only reliable reset (~47 s on an M3 via Rosetta).
# Rosetta: php-fpm segfaults with OPcache on → rosetta/zz-rosetta-no-opcache.ini is mounted.
# Usage: reset-shopping-admin.sh   (env: DOCKER_CONTEXT, default colima-wav)
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CTX="${DOCKER_CONTEXT:-colima-wav}"
NAME=webarena-verified-shopping_admin
docker --context "$CTX" rm -f "$NAME" >/dev/null 2>&1 || true
docker --context "$CTX" run -d --name "$NAME" --platform linux/amd64 \
  -p 127.0.0.1:7780:80 -p 127.0.0.1:7781:8877 \
  -v "$HERE/rosetta/zz-rosetta-no-opcache.ini:/usr/local/etc/php/conf.d/zz-rosetta-no-opcache.ini:ro" \
  am1n3e/webarena-verified-shopping_admin:latest >/dev/null
