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
    MINGW*|MSYS*|CYGWIN*)  # Windows (Git Bash): the usual install locations. [unverified on Windows]
      local pf86="${PROGRAMFILES:-C:/Program Files} (x86)"
      for c in "/c/Program Files/Google/Chrome/Application/chrome.exe" \
               "${pf86}/Google/Chrome/Application/chrome.exe" \
               "${LOCALAPPDATA:-}/Google/Chrome/Application/chrome.exe"; do
        [ -n "$c" ] && [ -f "$c" ] && { printf '%s\n' "$c"; return; }
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

# CDP port: env TANDEM_CDP_PORT, else the cdp-port file of the last start, else 9222.
# The env wins: an explicit override must not be shadowed by a stale file (same rule as paths.mjs).
cdp_port() {
  if [ -n "${TANDEM_CDP_PORT:-}" ]; then printf '%s\n' "$TANDEM_CDP_PORT"
  elif [ -f "$PORTFILE" ]; then cat "$PORTFILE"
  else printf '%s\n' 9222; fi
}

# The data dir holds a profile with live sessions, intercept logs and screenshots: 0700.
# chmod (not just umask) so a dir created by an older version gets tightened too.
ensure_data_dir() {
  mkdir -p "$DATA" "$PROFILE" "$LOGDIR"
  chmod 700 "$DATA" 2>/dev/null || true
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

# PID of the process LISTENING on the port (empty if none / no tool to ask).
port_listener_pid() {
  local port; port="$(cdp_port)"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null | head -1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnpH "sport = :${port}" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
  fi
}

# Who owns the CDP on the port? Prints: ours | foreign | unknown.
# A healthy CDP alone proves nothing: a personal Chrome with remote debugging, or an adapter with
# another data dir, can answer on the same port. But "foreign" is claimed only when a LOCAL listener
# is identified and lacks our --user-data-dir. When the listener can't be seen — Windows (Git Bash:
# no lsof/ss), or WSL driving the WINDOWS Chrome over mirrored networking (a real setup in use) — the
# answer is "unknown" and callers keep the old behavior (accept it, with a note), not refuse it.
cdp_owner() {
  local pid; pid="$(port_listener_pid)"
  if [ -z "$pid" ]; then echo unknown; return; fi
  if ps -o command= -p "$pid" 2>/dev/null | grep -qF -- "--user-data-dir=$PROFILE"; then echo ours; else echo foreign; fi
}

# Saved PID, if the process is still alive.
saved_pid_alive() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# --- external browser mode -----------------------------------------------------------
# TANDEM_BROWSER=external: tandem never launches or kills a browser — it only talks to the CDP port.
# For a browser tandem cannot manage: e.g. the WINDOWS Chrome driven from WSL over mirrored networking
# (certificates, AutoFirma), where tandem's own start would open a Linux Chrome without them, and its
# stop (pkill) cannot reach the Windows process. Optional delegation, run with `sh -c`:
#   TANDEM_BROWSER_START_CMD  how to start it (then tandem waits for CDP, up to ~15 s)
#   TANDEM_BROWSER_STOP_CMD   how to stop it (SessionEnd uses it when the last session ends)
external_mode() { [ "${TANDEM_BROWSER:-}" = external ]; }

wait_cdp() {
  local _
  for _ in $(seq 1 30); do cdp_healthy && return 0; sleep 0.5; done
  return 1
}

start_external() {
  local port; port="$(cdp_port)"
  if cdp_healthy; then echo "tandem: external browser answers (CDP 127.0.0.1:${port})."; return 0; fi
  if [ -z "${TANDEM_BROWSER_START_CMD:-}" ]; then
    echo "tandem: ERROR — external mode and no browser answers at 127.0.0.1:${port}." >&2
    echo "        Start your browser with remote debugging on that port, or set TANDEM_BROWSER_START_CMD." >&2
    return 1
  fi
  echo "tandem: starting the external browser (TANDEM_BROWSER_START_CMD)…"
  sh -c "$TANDEM_BROWSER_START_CMD" >>"$LOGDIR/chrome.log" 2>&1 || true
  if wait_cdp; then echo "tandem: external browser ready (CDP 127.0.0.1:${port})."; return 0; fi
  echo "tandem: ERROR — TANDEM_BROWSER_START_CMD ran but no CDP at 127.0.0.1:${port} after 15s. See $LOGDIR/chrome.log" >&2
  return 1
}

stop_external() {
  if [ -z "${TANDEM_BROWSER_STOP_CMD:-}" ]; then
    echo "tandem: external browser — not stopping it (no TANDEM_BROWSER_STOP_CMD)."; return 0
  fi
  sh -c "$TANDEM_BROWSER_STOP_CMD" >>"$LOGDIR/chrome.log" 2>&1 && echo "tandem: external browser stopped (TANDEM_BROWSER_STOP_CMD)."
}

# --- start / stop ------------------------------------------------------------------
start_chrome() {
  if external_mode; then mkdir -p "$LOGDIR"; chmod 700 "$DATA" 2>/dev/null || true; start_external; return; fi
  # Guard: locatable Chrome binary. Clear error instead of an opaque CDP timeout.
  if [ ! -x "$CHROME_BIN" ]; then
    echo "tandem: ERROR — Chrome/Chromium executable not found at:" >&2
    echo "        '$CHROME_BIN'" >&2
    echo "        Install it, or export TANDEM_CHROME_BIN with the path to your binary." >&2
    return 1
  fi
  ensure_data_dir
  local port; port="$(cdp_port)"

  # Idempotent: if CDP already responds AND it is our profile, nothing to do.
  if cdp_healthy; then
    case "$(cdp_owner)" in
      ours)    echo "tandem: Chrome already running (CDP at 127.0.0.1:${port})."; return 0 ;;
      unknown) echo "tandem: a browser already answers CDP at 127.0.0.1:${port} (its process is not visible here — e.g. Windows Chrome from WSL); using it."; return 0 ;;
    esac
    echo "tandem: ERROR — port ${port} answers CDP but it is NOT tandem's Chrome (profile $PROFILE)." >&2
    echo "        Another browser (or another tandem data dir) owns it. Close it or set TANDEM_CDP_PORT." >&2
    return 1
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
  # Stale profile lock: SingletonLock is a symlink "<hostname>-<pid>". The Mac's hostname follows the
  # network (DHCP/reverse DNS); after a change Chrome reports the profile "in use on another computer"
  # (seen in the bench, 2026-10-21; headless still started, headful shows a blocking dialog — not
  # verified here). No process uses this profile → the lock is stale by definition: drop it.
  if ! pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1; then
    rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"
  fi

  echo "${port}" > "$PORTFILE"
  # Append log (don't truncate): each start used to truncate the log and erase evidence of
  # the previous crash. Append + dated header per start = the next crash keeps its context.
  # Simple rotation (>512K → .prev) to prevent unbounded growth.
  if [ -f "$LOGDIR/chrome.log" ] && [ "$(wc -c < "$LOGDIR/chrome.log" 2>/dev/null || echo 0)" -gt 524288 ]; then
    mv -f "$LOGDIR/chrome.log" "$LOGDIR/chrome.log.prev"
  fi
  printf '\n===== tandem: start %s (port %s) =====\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "${port}" >> "$LOGDIR/chrome.log"
  echo "tandem: launching Chrome (dedicated profile, CDP 127.0.0.1:${port})…"
  # TANDEM_CHROME_ARGS: extra flags, word-split on purpose (e.g. "--headless=new --no-sandbox" in CI).
  local -a extra=()
  if [ -n "${TANDEM_CHROME_ARGS:-}" ]; then read -r -a extra <<< "$TANDEM_CHROME_ARGS"; fi
  # --disable-sync: a dedicated profile has no business syncing to a Google account (it was dialing
  # Google in the background, external audit). NOT --disable-background-networking: the human browses
  # and logs in here, and that flag also stops Safe Browsing and component (e.g. Widevine) updates.
  nohup "$CHROME_BIN" \
    --remote-debugging-port="${port}" \
    --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check --disable-sync \
    ${extra[@]+"${extra[@]}"} \
    about:blank \
    >>"$LOGDIR/chrome.log" 2>&1 &
  echo "$!" > "$PIDFILE"
  disown 2>/dev/null || true

  # Wait for CDP to come up (TANDEM_CDP_WAIT seconds, default 15). Counter unused: only limits retries.
  # Under heavy load (load1 ~20 in the bench) Chrome took 8–42 s just to reach its first log line.
  local _ wait="${TANDEM_CDP_WAIT:-15}"
  for _ in $(seq 1 $((wait * 2))); do
    cdp_healthy && { echo "tandem: Chrome ready (CDP 127.0.0.1:${port})."; return 0; }
    sleep 0.5
  done
  echo "tandem: ERROR — Chrome did not expose CDP in ${wait}s. Check $LOGDIR/chrome.log (slow machine? TANDEM_CDP_WAIT)" >&2
  return 1
}

stop_chrome() {
  if external_mode; then mkdir -p "$LOGDIR"; stop_external; return; fi
  local stopped=1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null && stopped=0
  fi
  # Fallback: kill by user-data-dir (does not touch the personal Chrome: different profile).
  # pgrep/pkill take a regex; `--` keeps the leading dashes of the flag from parsing as options.
  if pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1; then
    pkill -f -- "--user-data-dir=$PROFILE" 2>/dev/null && stopped=0
  fi
  # Wait for it to really exit (up to ~10s, inside SessionEnd's 15 s budget: on a loaded machine Chrome is slow to flush cookies/session
  # to the profile), then SIGKILL: a restart that races a dying Chrome finds the SingletonLock held.
  local _
  for _ in $(seq 1 40); do
    pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1 || break
    sleep 0.25
  done
  pkill -9 -f -- "--user-data-dir=$PROFILE" 2>/dev/null || true
  rm -f "$PIDFILE"
  if [ "$stopped" -eq 0 ]; then echo "tandem: Chrome stopped."; else echo "tandem: no active tandem Chrome found."; fi
}

status_chrome() {
  local port; port="$(cdp_port)"
  echo "tandem — status:"
  if external_mode; then echo "  mode:     external browser (tandem does not start/stop it)"; else echo "  profile:  $PROFILE"; fi
  echo "  port:     ${port}"
  local owner=""; cdp_healthy && owner="$(cdp_owner)"
  external_mode && [ -n "$owner" ] && owner=external   # a browser that is not ours is the point here
  if [ "$owner" = foreign ]; then
    echo "  CDP:      ⚠ a browser answers on ${port} but it is NOT tandem's profile"
  elif [ -n "$owner" ]; then
    [ "$owner" = unknown ] && echo "  owner:    not visible from here (external browser, e.g. Windows Chrome from WSL)"
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
