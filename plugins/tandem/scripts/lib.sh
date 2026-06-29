#!/usr/bin/env bash
# lib.sh — shared functions for the tandem plugin (shared Chrome lifecycle).
# Philosophy: the source of truth for state is the CDP healthcheck, not the PID (on macOS the
# app can be alive without windows and the PID file can lie). Everything on loopback. Dedicated profile.

set -u

# --- paths and config ---------------------------------------------------------------
# Chrome/Chromium binary. Explicit override via TANDEM_CHROME_BIN; otherwise auto-detect
# by platform (macOS + Linux). Windows not supported: this plugin is bash/CDP over POSIX.
detect_chrome() {
  if [ -n "${TANDEM_CHROME_BIN:-}" ]; then printf '%s\n' "$TANDEM_CHROME_BIN"; return; fi
  local c
  case "$(uname -s)" in
    Darwin)
      for c in \
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
        "/Applications/Chromium.app/Contents/MacOS/Chromium" \
        "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"; do
        [ -x "$c" ] && { printf '%s\n' "$c"; return; }
      done ;;
    *)  # Linux and other POSIX: search PATH for common names.
      for c in google-chrome google-chrome-stable chromium chromium-browser chrome brave-browser; do
        if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
      done ;;
  esac
  # Not found: return the macOS default so the start guard gives a clear error.
  printf '%s\n' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}
CHROME_BIN="$(detect_chrome)"

# Persistent state directory. FIXED PATH intentionally: ${CLAUDE_PLUGIN_DATA} is NOT
# available in the bash injection of slash commands — only in the MCP server and hooks.
# If we depended on it, commands and MCP would use different data dirs (divergent Chrome
# profile). A fixed path guarantees consistency across all contexts.
# Override with TANDEM_DATA_DIR if needed.
tandem_data_dir() {
  printf '%s\n' "${TANDEM_DATA_DIR:-$HOME/.claude/tandem}"
}

DATA="$(tandem_data_dir)"
PROFILE="$DATA/chrome-profile"
PIDFILE="$DATA/chrome.pid"
PORTFILE="$DATA/cdp-port"
LOGDIR="$DATA/logs"

# CDP port: cdp-port file if it exists, else env, else 9222.
cdp_port() {
  if [ -f "$PORTFILE" ]; then cat "$PORTFILE"
  else printf '%s\n' "${TANDEM_CDP_PORT:-9222}"; fi
}

# --- checks -------------------------------------------------------------------------
# CDP responds on the port (source of truth).
cdp_healthy() {
  local port; port="$(cdp_port)"
  curl -s --max-time 2 "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1
}

# Is something listening on the port? (prints the COMMAND/program of the listener, or empty)
# lsof (macOS and most Linux); fallback to `ss` (Linux without lsof).
port_listener() {
  local port; port="$(cdp_port)"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1}'
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :${port}" 2>/dev/null | grep -oE 'users:\(\("[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"/\1/'
  fi
}

# Saved PID, if the process is still alive.
saved_pid_alive() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# --- start / stop ------------------------------------------------------------------
start_chrome() {
  # Guard: locatable Chrome binary. Clear error instead of an opaque CDP timeout.
  if [ ! -x "$CHROME_BIN" ]; then
    echo "tandem: ERROR — Chrome/Chromium executable not found at:" >&2
    echo "        '$CHROME_BIN'" >&2
    echo "        Install it, or export TANDEM_CHROME_BIN with the path to your binary." >&2
    return 1
  fi
  mkdir -p "$PROFILE" "$LOGDIR"
  local port; port="$(cdp_port)"

  # Idempotent: if CDP already responds, assume our Chrome is alive.
  if cdp_healthy; then
    echo "tandem: Chrome already running (CDP at 127.0.0.1:${port})."
    return 0
  fi

  # Port taken by something that does NOT serve a healthy CDP → don't clobber, fail clearly.
  local listener; listener="$(port_listener)"
  if [ -n "$listener" ]; then
    echo "tandem: ERROR — port ${port} is already taken by '${listener}' and does not respond to CDP." >&2
    echo "        Stop that process or set TANDEM_CDP_PORT to a different port." >&2
    return 1
  fi

  # Stale PID file (dead process): clean up before relaunching.
  if [ -f "$PIDFILE" ] && ! saved_pid_alive; then rm -f "$PIDFILE"; fi

  echo "${port}" > "$PORTFILE"
  # Append log (don't truncate): each start used to truncate the log and erase evidence of
  # the previous crash. Append + dated header per start = the next crash keeps its context.
  # Simple rotation (>512K → .prev) to prevent unbounded growth.
  if [ -f "$LOGDIR/chrome.log" ] && [ "$(wc -c < "$LOGDIR/chrome.log" 2>/dev/null || echo 0)" -gt 524288 ]; then
    mv -f "$LOGDIR/chrome.log" "$LOGDIR/chrome.log.prev"
  fi
  printf '\n===== tandem: start %s (port %s) =====\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "${port}" >> "$LOGDIR/chrome.log"
  echo "tandem: launching Chrome (dedicated profile, CDP 127.0.0.1:${port})…"
  nohup "$CHROME_BIN" \
    --remote-debugging-port="${port}" \
    --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check \
    about:blank \
    >>"$LOGDIR/chrome.log" 2>&1 &
  echo "$!" > "$PIDFILE"
  disown 2>/dev/null || true

  # Wait for CDP to come up (up to ~15s). Counter unused: only limits retries.
  local _
  for _ in $(seq 1 30); do
    cdp_healthy && { echo "tandem: Chrome ready (CDP 127.0.0.1:${port})."; return 0; }
    sleep 0.5
  done
  echo "tandem: ERROR — Chrome did not expose CDP in 15s. Check $LOGDIR/chrome.log" >&2
  return 1
}

stop_chrome() {
  local stopped=1
  if saved_pid_alive; then
    kill "$(cat "$PIDFILE")" 2>/dev/null && stopped=0
  fi
  # Fallback: kill by user-data-dir (does not touch the personal Chrome: different profile).
  if pgrep -f "user-data-dir=$PROFILE" >/dev/null 2>&1; then
    pkill -f "user-data-dir=$PROFILE" 2>/dev/null && stopped=0
  fi
  rm -f "$PIDFILE"
  if [ "$stopped" -eq 0 ]; then echo "tandem: Chrome stopped."; else echo "tandem: no active tandem Chrome found."; fi
}

status_chrome() {
  local port; port="$(cdp_port)"
  echo "tandem — status:"
  echo "  profile:  $PROFILE"
  echo "  port:     ${port}"
  if cdp_healthy; then
    local ver; ver="$(curl -s --max-time 2 "http://127.0.0.1:${port}/json/version" | sed -n 's/.*"Browser": *"\([^"]*\)".*/\1/p')"
    echo "  CDP:      ✅ active (${ver:-?})"
    local n; n="$(curl -s "http://127.0.0.1:${port}/json" | grep -c '"type": "page"' 2>/dev/null)"
    echo "  tabs:     ${n:-?}"
  else
    echo "  CDP:      ❌ not responding"
    saved_pid_alive && echo "  warning:  PID file exists with live PID but no CDP (profile locked?)."
  fi
  return 0   # status is informational: never fails based on daemon state
}
