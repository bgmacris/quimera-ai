#!/usr/bin/env bash
# chrome-daemon.sh — control for tandem's shared Chrome.
# Usage: chrome-daemon.sh {start|stop|restart|status}
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
# shellcheck disable=SC1091  # dynamic source ($HERE): correct at runtime, not statically resolvable
. "$HERE/lib.sh"

case "${1:-status}" in
  start)   start_chrome ;;
  stop)    stop_chrome ;;
  restart) stop_chrome; sleep 1; start_chrome ;;
  status)  status_chrome ;;
  *) echo "usage: $(basename "$0") {start|stop|restart|status}" >&2; exit 2 ;;
esac
