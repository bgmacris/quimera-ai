#!/usr/bin/env node
// selector.test.mjs — tests del generador de selectores Playwright (scripts/selector.mjs).
// Sin dependencias: mini-runner. Cubre los escapes que se teclean mal a mano (la razón de ser
// del helper): comillas en el name, metacaracteres en modo regex, el '/' delimitador, anclaje,
// unicode/acentos, el caso plantilla (id concreto), y que todo lo generado quede bien formado.
// Uso: node tests/selector.test.mjs   (exit 0 = verde).

import {
  buildSelector, escapeStringName, escapeRegexName, isWellFormed,
} from '../scripts/selector.mjs';

let pass = 0; let fail = 0;
function t(desc, got, want) {
  if (got === want) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}\n`); }
}
function ok(desc, cond) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n`); }
}

// --- string mode (name exacto) ----------------------------------------------------
process.stdout.write('[string]\n');
t('básico', buildSelector({ role: 'button', name: 'Nuevo ticket' }), 'role=button[name="Nuevo ticket"]');
t('comilla doble escapada', buildSelector({ role: 'button', name: 'Buscar "tickets"' }), 'role=button[name="Buscar \\"tickets\\""]');
t('backslash escapado', buildSelector({ role: 'link', name: 'a\\b' }), 'role=link[name="a\\\\b"]');
t('acentos sin tocar', buildSelector({ role: 'textbox', name: 'Día válido' }), 'role=textbox[name="Día válido"]');
t('apóstrofo sin escape (comillas dobles)', buildSelector({ role: 'cell', name: "N.º d'ordre" }), 'role=cell[name="N.º d\'ordre"]');
t('sin name → role suelto', buildSelector({ role: 'navigation', name: '' }), 'role=navigation');
t('name nulo → role suelto', buildSelector({ role: 'main' }), 'role=main');

// --- regex mode (substring, robusto para nombres largos/dinámicos) ----------------
process.stdout.write('[regex]\n');
t('substring simple', buildSelector({ role: 'textbox', name: 'Buscar por número', regex: true }), 'role=textbox[name=/Buscar por número/]');
t('metacaracteres escapados', buildSelector({ role: 'textbox', name: 'N.º (1)', regex: true }), 'role=textbox[name=/N\\.º \\(1\\)/]');
t('slash delimitador escapado', buildSelector({ role: 'link', name: 'a/b', regex: true }), 'role=link[name=/a\\/b/]');
// el guión fuera de [...] es literal en regex → NO se escapa (sería ruido).
t('anclaje al inicio (plantilla con id concreto)', buildSelector({ role: 'row', name: 'TCK-2026-016', regex: true, anchor: true }), 'role=row[name=/^TCK-2026-016/]');
t('anchor sin regex se ignora (string mode)', buildSelector({ role: 'button', name: 'X', anchor: true }), 'role=button[name="X"]');

// --- escapes unitarios ------------------------------------------------------------
process.stdout.write('[escapes]\n');
t('escapeStringName comillas', escapeStringName('di "hola"'), 'di \\"hola\\"');
t('escapeRegexName puntos/paréntesis', escapeRegexName('v1.2 (beta)'), 'v1\\.2 \\(beta\\)');
t('escapeRegexName barra', escapeRegexName('a/b'), 'a\\/b');

// --- validación + errores ---------------------------------------------------------
process.stdout.write('[bien formado / errores]\n');
ok('string generado es bien formado', isWellFormed(buildSelector({ role: 'button', name: 'Guardar "ya"' })));
ok('regex generado es bien formado', isWellFormed(buildSelector({ role: 'row', name: 'TCK-1', regex: true, anchor: true })));
ok('role suelto es bien formado', isWellFormed('role=main'));
ok('detecta corchete sin cerrar', !isWellFormed('role=button[name="x"'));
ok('detecta comilla sin cerrar', !isWellFormed('role=button[name="x]'));
ok('detecta regex sin cerrar', !isWellFormed('role=row[name=/^x]'));
ok('vacío no es bien formado', !isWellFormed(''));
let threw = false;
try { buildSelector({ name: 'sin role' }); } catch { threw = true; }
ok('lanza si falta role', threw);

// invariante: todo lo que genera buildSelector con name no vacío pasa isWellFormed.
const fuzz = ['Hola', 'a"b', 'a\\b', 'N.º (1)', 'a/b/c', 'TCK-2026-016', "d'ord"];
let allWF = true;
for (const n of fuzz) {
  for (const rx of [false, true]) {
    if (!isWellFormed(buildSelector({ role: 'x', name: n, regex: rx, anchor: rx }))) { allWF = false; }
  }
}
ok('invariante: todo selector generado es bien formado', allWF);

// --- resumen ----------------------------------------------------------------------
process.stdout.write(`\nselector: ${pass} ok, ${fail} fallos\n`);
process.exit(fail === 0 ? 0 : 1);
