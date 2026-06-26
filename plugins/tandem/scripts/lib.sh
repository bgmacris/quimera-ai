#!/usr/bin/env bash
# lib.sh — funciones compartidas del plugin tandem (ciclo de vida del Chrome compartido).
# Filosofía: la VERDAD del estado es el healthcheck CDP, no el PID (en macOS la app puede
# vivir sin ventanas y el PID-file puede mentir). Todo en loopback. Perfil dedicado.

set -u

# --- rutas y config -----------------------------------------------------------------
# Binario de Chrome/Chromium. Override explícito con TANDEM_CHROME_BIN; si no, autodetección
# por plataforma (macOS + Linux). Windows no soportado: este plugin es bash/CDP sobre POSIX.
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
    *)  # Linux y otros POSIX: buscar en PATH por los nombres habituales.
      for c in google-chrome google-chrome-stable chromium chromium-browser chrome brave-browser; do
        if command -v "$c" >/dev/null 2>&1; then command -v "$c"; return; fi
      done ;;
  esac
  # No encontrado: devuelve el default de macOS para que el guard de arranque dé un error claro.
  printf '%s\n' "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}
CHROME_BIN="$(detect_chrome)"

# Directorio de estado persistente. RUTA FIJA a propósito: NO usamos ${CLAUDE_PLUGIN_DATA}
# porque esa variable solo está disponible para el MCP server y los hooks, NO en la inyección
# bash de los slash commands. Si dependiéramos de ella, commands y MCP usarían data dirs
# distintos (perfil de Chrome divergente). Una ruta fija garantiza coherencia en todos los
# contextos. Override con TANDEM_DATA_DIR si hace falta.
tandem_data_dir() {
  printf '%s\n' "${TANDEM_DATA_DIR:-$HOME/.claude/tandem}"
}

DATA="$(tandem_data_dir)"
PROFILE="$DATA/chrome-profile"
PIDFILE="$DATA/chrome.pid"
PORTFILE="$DATA/cdp-port"
LOGDIR="$DATA/logs"

# Puerto CDP: fichero cdp-port si existe, si no env, si no 9222.
cdp_port() {
  if [ -f "$PORTFILE" ]; then cat "$PORTFILE"
  else printf '%s\n' "${TANDEM_CDP_PORT:-9222}"; fi
}

# --- chequeos -----------------------------------------------------------------------
# CDP responde en el puerto (la fuente de verdad).
cdp_healthy() {
  local port; port="$(cdp_port)"
  curl -s --max-time 2 "http://127.0.0.1:${port}/json/version" >/dev/null 2>&1
}

# ¿Hay algo escuchando el puerto? (imprime el COMMAND/programa del listener, o vacío)
# lsof (macOS y la mayoría de Linux); fallback a `ss` (Linux sin lsof).
port_listener() {
  local port; port="$(cdp_port)"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $1}'
  elif command -v ss >/dev/null 2>&1; then
    # ss: extrae el nombre de programa de users:(("prog",pid,fd)) si está disponible.
    ss -ltnH "sport = :${port}" 2>/dev/null | grep -oE 'users:\(\("[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"/\1/'
  fi
}

# PID guardado, si el proceso sigue vivo.
saved_pid_alive() {
  [ -f "$PIDFILE" ] || return 1
  local pid; pid="$(cat "$PIDFILE" 2>/dev/null)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# --- arranque / parada --------------------------------------------------------------
start_chrome() {
  # Guard: binario de Chrome localizable. Error claro en vez de un timeout opaco de CDP.
  if [ ! -x "$CHROME_BIN" ]; then
    echo "tandem: ERROR — no encuentro Chrome/Chromium ejecutable en:" >&2
    echo "        '$CHROME_BIN'" >&2
    echo "        Instálalo, o exporta TANDEM_CHROME_BIN con la ruta a tu binario." >&2
    return 1
  fi
  mkdir -p "$PROFILE" "$LOGDIR"
  local port; port="$(cdp_port)"

  # Idempotente: si CDP ya responde, asumimos nuestro Chrome vivo.
  if cdp_healthy; then
    echo "tandem: Chrome ya activo (CDP en 127.0.0.1:${port})."
    return 0
  fi

  # Puerto ocupado por algo que NO levanta CDP sano -> no pisar, fallar claro.
  local listener; listener="$(port_listener)"
  if [ -n "$listener" ]; then
    echo "tandem: ERROR — el puerto ${port} ya está ocupado por '${listener}' y no responde a CDP." >&2
    echo "        Cierra ese proceso o define TANDEM_CDP_PORT en otro puerto." >&2
    return 1
  fi

  # PID-file stale (proceso muerto): limpiar antes de relanzar.
  if [ -f "$PIDFILE" ] && ! saved_pid_alive; then rm -f "$PIDFILE"; fi

  echo "${port}" > "$PORTFILE"
  # Log en APPEND (no truncar): cada arranque truncaba el log y borraba la evidencia de la
  # muerte anterior. Append + cabecera fechada por arranque = la próxima caída queda con su
  # contexto. Rotación simple (>512K → .prev) para no crecer sin límite.
  if [ -f "$LOGDIR/chrome.log" ] && [ "$(wc -c < "$LOGDIR/chrome.log" 2>/dev/null || echo 0)" -gt 524288 ]; then
    mv -f "$LOGDIR/chrome.log" "$LOGDIR/chrome.log.prev"
  fi
  printf '\n===== tandem: arranque %s (puerto %s) =====\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')" "${port}" >> "$LOGDIR/chrome.log"
  echo "tandem: lanzando Chrome (perfil dedicado, CDP 127.0.0.1:${port})…"
  nohup "$CHROME_BIN" \
    --remote-debugging-port="${port}" \
    --user-data-dir="$PROFILE" \
    --no-first-run --no-default-browser-check \
    about:blank \
    >>"$LOGDIR/chrome.log" 2>&1 &
  echo "$!" > "$PIDFILE"
  disown 2>/dev/null || true

  # Esperar a que CDP levante (hasta ~15s). El contador no se usa: solo limita los reintentos.
  local _
  for _ in $(seq 1 30); do
    cdp_healthy && { echo "tandem: Chrome listo (CDP 127.0.0.1:${port})."; return 0; }
    sleep 0.5
  done
  echo "tandem: ERROR — Chrome no expuso CDP en 15s. Mira $LOGDIR/chrome.log" >&2
  return 1
}

stop_chrome() {
  local stopped=1
  if saved_pid_alive; then
    kill "$(cat "$PIDFILE")" 2>/dev/null && stopped=0
  fi
  # Respaldo: matar por user-data-dir (no toca el Chrome personal: perfil distinto).
  if pgrep -f "user-data-dir=$PROFILE" >/dev/null 2>&1; then
    pkill -f "user-data-dir=$PROFILE" 2>/dev/null && stopped=0
  fi
  rm -f "$PIDFILE"
  if [ "$stopped" -eq 0 ]; then echo "tandem: Chrome detenido."; else echo "tandem: no había Chrome de tandem activo."; fi
}

status_chrome() {
  local port; port="$(cdp_port)"
  echo "tandem — estado:"
  echo "  perfil:   $PROFILE"
  echo "  puerto:   ${port}"
  if cdp_healthy; then
    local ver; ver="$(curl -s --max-time 2 "http://127.0.0.1:${port}/json/version" | sed -n 's/.*"Browser": *"\([^"]*\)".*/\1/p')"
    echo "  CDP:      ✅ activo (${ver:-?})"
    local n; n="$(curl -s "http://127.0.0.1:${port}/json" | grep -c '"type": "page"' 2>/dev/null)"
    echo "  pestañas: ${n:-?}"
  else
    echo "  CDP:      ❌ no responde"
    saved_pid_alive && echo "  aviso:    hay un PID guardado vivo pero sin CDP (¿perfil bloqueado?)."
  fi
  return 0   # status es informativo: nunca falla por el estado del daemon
}
