#!/usr/bin/env bash
# chrome-daemon.sh — control for tandem's shared Chrome.
# Usage: chrome-daemon.sh {start|stop|restart|status|owner}   (owner → ours|foreign|unknown)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
# shellcheck disable=SC1091  # dynamic source ($HERE): correct at runtime, not statically resolvable
. "$HERE/lib.sh"

case "${1:-status}" in
  start)   start_chrome ;;
  stop)    stop_chrome ;;
  restart) stop_chrome; start_chrome ;;   # stop_chrome waits for the process to exit
  status)  status_chrome ;;
  owner)   cdp_owner ;;
  *) echo "usage: $(basename "$0") {start|stop|restart|status|owner}" >&2; exit 2 ;;
esac
