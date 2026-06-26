#!/usr/bin/env node
// selector.mjs — generador/validador de selectores Playwright para tandem:map (navegación frugal).
//
// El perfil de un sitio (sites/<host>.md) guarda, por locator, un `sel:` EJECUTABLE que el agente
// pasa como `target` a browser_click/type/evaluate para accionar SIN browser_snapshot (el snapshot
// del árbol de accesibilidad pesa ~18× el perfil entero — ver docs/01). Ese `target` llega a
// page.locator(), que acepta CSS y los engines Playwright (role=, text=, ...).
//
// Por qué un helper y no teclear el selector a mano: la sintaxis tiene escapes no obvios —comillas
// dentro del name, metacaracteres en modo regex, el '/' que delimita la regex—. Tecleados a mano en
// cada perfil producen selectores rotos en silencio. Misma lección que page-signals.mjs: la
// sintaxis crítica vive en código con tests, no en prosa. Es helper de AUTORÍA (se usa al redactar
// el `sel:` en recon); en runtime el MCP ya recibe el `sel:` escrito.
//
// Semántica Playwright relevante: `role=R[name="X"]` casa el accessible name EXACTO (insensible a
// mayúsculas, recortado); para SUBSTRING (robusto ante nombres largos/dinámicos) se usa regex
// `role=R[name=/X/]`. locator() es estricto: si el selector casa >1 elemento, la acción lanza —por
// eso los locators de CLASE (filas, items) van como PLANTILLA con un id concreto, no como prefijo.
//
// Uso CLI:  selector.mjs <role> <name> [--regex] [--anchor]
//   --regex   name como patrón substring (robusto para nombres largos/dinámicos)
//   --anchor  con --regex, ancla al inicio (^) — p.ej. una fila 'TCK-2026-016…'
// Ejemplos:
//   selector.mjs button "Nuevo ticket"                 → role=button[name="Nuevo ticket"]
//   selector.mjs textbox "Buscar" --regex              → role=textbox[name=/Buscar/]
//   selector.mjs row "TCK-2026-016" --regex --anchor   → role=row[name=/^TCK\-2026\-016/]

// Escapa un literal para colocarlo entre comillas dobles de un selector Playwright.
export function escapeStringName(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Escapa un literal para usarlo como patrón regex (todos los metacaracteres, incluido el '/'
// que delimita la expresión). $& = la coincidencia entera.
export function escapeRegexName(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// Construye el selector. name literal SIEMPRE (el helper escapa lo que toque). Sin name → role
// suelto (válido pero arriesgado: solo para roles que el agente sabe únicos en la página).
export function buildSelector({ role, name, regex = false, anchor = false } = {}) {
  if (!role || typeof role !== 'string') throw new Error('falta role');
  if (name == null || name === '') return `role=${role}`;
  if (regex) {
    const pat = (anchor ? '^' : '') + escapeRegexName(name);
    return `role=${role}[name=/${pat}/]`;
  }
  return `role=${role}[name="${escapeStringName(name)}"]`;
}

// Validación sintáctica BARATA (no es un parser Playwright): detecta los errores de escape más
// comunes —corchetes desbalanceados, comillas o slashes sin cerrar—. true = bien formado.
export function isWellFormed(sel) {
  if (typeof sel !== 'string' || !sel.length) return false;
  if ((sel.match(/\[/g) || []).length !== (sel.match(/\]/g) || []).length) return false;
  const m = sel.match(/name=(.*)\]/);
  if (!m) return true; // CSS u otro engine sin name= → no lo juzgamos aquí
  const v = m[1];
  if (v.startsWith('/')) return /^\/.*\/[a-z]*$/.test(v); // regex: /…/ con flags opcionales
  return /^".*"$/.test(v);                                // string: "…" balanceadas
}

// --- CLI ----------------------------------------------------------------------------
import { fileURLToPath } from 'node:url';
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [role, name] = argv.filter((a) => !a.startsWith('--'));
  if (!role) {
    process.stderr.write('uso: selector.mjs <role> <name> [--regex] [--anchor]\n');
    process.exit(2);
  }
  try {
    process.stdout.write(buildSelector({
      role, name, regex: flags.has('--regex'), anchor: flags.has('--anchor'),
    }) + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write('selector: ' + e.message + '\n');
    process.exit(2);
  }
}
