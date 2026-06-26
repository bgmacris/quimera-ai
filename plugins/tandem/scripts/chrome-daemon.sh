#!/usr/bin/env bash
# chrome-daemon.sh — control del Chrome compartido de tandem.
# Uso: chrome-daemon.sh {start|stop|restart|status}
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
# shellcheck disable=SC1091  # source dinámico ($HERE): correcto en runtime, no resoluble estáticamente
. "$HERE/lib.sh"

case "${1:-status}" in
  start)   start_chrome ;;
  stop)    stop_chrome ;;
  restart) stop_chrome; sleep 1; start_chrome ;;
  status)  status_chrome ;;
  *) echo "uso: $(basename "$0") {start|stop|restart|status}" >&2; exit 2 ;;
esac
