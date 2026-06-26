#!/usr/bin/env node
// hook-inject-profile.mjs — hook PostToolUse de tandem:map.
//
// Al navegar (tool MCP browser_navigate), si hay un perfil de sitio para ese host en
// ~/.claude/tandem/sites/<host>.md, lo inyecta en el contexto del modelo vía
// hookSpecificOutput.additionalContext (campo soportado por PostToolUse — verificado
// contra la Hooks Reference oficial, 2026-06-22). Si no hay perfil, SILENCIO (cero ruido).
//
// Disciplina (pitfalls de la investigación, ver docs/01-memoria-de-navegacion.md):
//  - Solo inyecta si EXISTE perfil para el host.
//  - UNA VEZ por (sesión, host): marca en .hook-state/<session_id>/<host> para no
//    re-inyectar el mismo perfil en cada click dentro del sitio (context bloat).
//
// En node a propósito: node ya es dependencia del plugin (el MCP es @playwright/mcp);
// parsea/emite JSON nativo y normaliza el host con new URL(). Cero dependencia nueva (jq).
//
// Uso: por stdin recibe el JSON del hook. Sin args = modo inyección.
//      con arg "cleanup" = borra el marcador de la sesión (lo llama SessionEnd).

import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from 'node:fs';

const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
const sitesDir = join(dataDir, 'sites');
const stateDir = join(dataDir, '.hook-state');

// Lee stdin entero (síncrono, simple para un hook).
function readStdin() {
  try { return readFileSync(0, 'utf8'); } catch { return ''; }
}

// Salir en silencio: exit 0 sin stdout = el hook no hace nada.
function silent() { process.exit(0); }

const raw = readStdin();
let input;
try { input = JSON.parse(raw); } catch { silent(); }

const sessionId = (input && input.session_id) || 'no-session';

// --- modo cleanup (SessionEnd) ----------------------------------------------------
if (process.argv[2] === 'cleanup') {
  try { rmSync(join(stateDir, sessionId), { recursive: true, force: true }); } catch {}
  process.exit(0);
}

// --- modo inyección (PostToolUse browser_navigate) --------------------------------
const url = input?.tool_input?.url;
if (!url || typeof url !== 'string') silent();

let host;
try { host = new URL(url).hostname.toLowerCase(); } catch { silent(); }
if (!host) silent();

const profilePath = join(sitesDir, `${host}.md`);
if (!existsSync(profilePath)) silent();           // no hay perfil → silencio

// Una vez por (sesión, host).
const marker = join(stateDir, sessionId, host);
if (existsSync(marker)) silent();                 // ya inyectado esta sesión → silencio
try {
  mkdirSync(join(stateDir, sessionId), { recursive: true });
  writeFileSync(marker, '');
} catch {}

let profile;
try { profile = readFileSync(profilePath, 'utf8'); } catch { silent(); }

const context = [
  `tandem:map — perfil de navegación de ${host} (cargado automáticamente al navegar).`,
  `Úsalo para navegar este sitio SABIENDO en vez de re-derivar el DOM. Ancla por rol+nombre,`,
  `nunca por refs eNN (efímeros). Re-check barato antes de fiarte de un locator; si falla,`,
  `re-deriva en vivo y actualiza el perfil (no lo repares a ciegas).`,
  ``,
  profile,
].join('\n');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PostToolUse',
    additionalContext: context,
  },
}));
process.exit(0);
