#!/usr/bin/env node
// recipe.test.mjs — tests del compilador de recetas (scripts/recipe.mjs).
// Sin deps: mini-runner + un perfil de ejemplo inline. Cubre parseo, validación, compilación
// --fast/--step, relleno de plantilla con escape, y —lo crítico— que un valor hostil queda INERTE
// en el código compilado (browser_run_code_unsafe es RCE-equivalent).
// Uso: node tests/recipe.test.mjs   (exit 0 = verde).

import {
  parseProfile, parseRecipes, parseLocators, validate,
  compileFast, compileSteps, fillTemplate, assertCompiledSafe,
} from '../scripts/recipe.mjs';

let pass = 0; let fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function t(d, got, want) { if (eq(got, want)) { pass++; process.stdout.write(`  ✓ ${d}\n`); } else { fail++; process.stdout.write(`  ✗ ${d}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}\n`); } }
function ok(d, c) { if (c) { pass++; process.stdout.write(`  ✓ ${d}\n`); } else { fail++; process.stdout.write(`  ✗ ${d}\n`); } }

const MD = `## Locators (multi-ancla)
- busqueda-tickets:
    sel:       role=textbox[name=/Buscar por número/]
    primario:  textbox
- fila-de-ticket:
    sel:       span.ticket-number >> text="{id}" >> visible=true
    primario:  fila
- fila-regex:
    sel:       role=row[name=/^{id}/]
- sin-sel:
    primario:  solo legible
- item-pod:
    sel:       article.product_pod

## Recetas
abrir-ticket-por-id(id):
  - type:     busqueda-tickets  <- {id}
  - click:    fila-de-ticket    <- {id}
  - wait-url: /tickets/
  - return:   url

navegar-a(url):
  - navigate: <- {url}
  - extract:  item-pod

mala-accion():
  - clik:     busqueda-tickets

loc-inexistente():
  - click:    no-existe

usa-sin-sel():
  - click:    sin-sel

extract-loc-inexistente():
  - extract:  no-existe

navigate-con-hueco():
  - navigate: "{url}"

## Otra cosa
- ignorar esto
`;

// --- parseo -----------------------------------------------------------------------
process.stdout.write('[parseo]\n');
const { locators, recipes } = parseProfile(MD);
ok('parsea 5 locators', locators.size === 5);
t('sel de busqueda-tickets', locators.get('busqueda-tickets').sel, 'role=textbox[name=/Buscar por número/]');
t('detecta plantilla (holes)', locators.get('fila-de-ticket').holes, ['id']);
ok('locator sin sel: → sel null', locators.get('sin-sel').sel === null);
ok('parsea 7 recetas', recipes.size === 7);
const receta = recipes.get('abrir-ticket-por-id');
t('firma de la receta', receta.params, ['id']);
t('nº de pasos', receta.steps.length, 4);
t('paso type con arg param', receta.steps[0], { action: 'type', operand: 'busqueda-tickets', arg: { kind: 'param', name: 'id' } });

// --- fillTemplate (escape por engine) ---------------------------------------------
process.stdout.write('[fillTemplate]\n');
t('plantilla string-engine', fillTemplate('span.ticket-number >> text="{id}" >> visible=true', { id: 'TCK-2026-123' }), 'span.ticket-number >> text="TCK-2026-123" >> visible=true');
t('plantilla regex-engine escapa metacaracteres', fillTemplate('role=row[name=/^{id}/]', { id: 'A.B' }), 'role=row[name=/^A\\.B/]');
t('plantilla string escapa comillas', fillTemplate('text="{x}"', { x: 'a"b' }), 'text="a\\"b"');

// --- validación -------------------------------------------------------------------
process.stdout.write('[validación]\n');
ok('receta canónica válida', validate(receta, locators).ok);
ok('acción desconocida detectada', !validate(recipes.get('mala-accion'), locators).ok);
ok('locator inexistente detectado', !validate(recipes.get('loc-inexistente'), locators).ok);
ok('locator sin sel detectado', !validate(recipes.get('usa-sin-sel'), locators).ok);
const fakeParam = { name: 'x', params: [], steps: [{ action: 'type', operand: 'busqueda-tickets', arg: { kind: 'param', name: 'noexiste' } }] };
ok('param no declarado detectado', !validate(fakeParam, locators).ok);
// H2: extract con locator inexistente debe dar error (antes: continue ciego)
ok('extract locator inexistente detectado', !validate(recipes.get('extract-loc-inexistente'), locators).ok);
// H2: extract con locator válido (item-pod) debe pasar
ok('extract locator válido pasa', validate(recipes.get('navegar-a'), locators).ok);
// H2: navigate con {…} en operando sin <- genera warning
const navHueco = validate(recipes.get('navigate-con-hueco'), locators);
ok('navigate con {…} en operando genera warning', navHueco.ok && navHueco.warnings.length > 0);

// --- compileFast ------------------------------------------------------------------
process.stdout.write('[compileFast]\n');
const code = compileFast(receta, locators, { id: 'TCK-2026-123' });
ok('es función async (page)', /^async \(page\) => \{/.test(code));
ok('type → fill', code.includes('.fill("TCK-2026-123")'));
ok('click → plantilla rellena', code.includes('text=\\"TCK-2026-123\\"') || code.includes('text="TCK-2026-123"'));
ok('wait-url → waitForURL includes', /waitForURL.*includes\("\/tickets\/"\)/.test(code));
ok('return url → page.url()', code.includes('return page.url();'));
ok('pasa assertCompiledSafe', assertCompiledSafe(code) === true);
ok('es JS parseable', (() => { try { new Function('page', `return (${code})`); return true; } catch { return false; } })());
// H3: navigate con <- {param} usa el valor del arg, sin doble comilla
const navReceta = recipes.get('navegar-a');
const navCode = compileFast(navReceta, locators, { url: 'https://example.com/page-1' });
ok('H3: navigate usa arg (url sustituida)', navCode.includes('"https://example.com/page-1"'));
ok('H3: navigate no doble-comilla el placeholder', !navCode.includes('"{url}"') && !navCode.includes("'{url}'"));
// H1: extract con locator plano — compileFast devuelve textContent, no corta el nombre
const extractCode = compileFast(navReceta, locators, { url: 'https://example.com' });
ok('H1: extract locator plano usa sel correcto', extractCode.includes('"article.product_pod"'));
ok('H1: nombre de locator no mutilado (no item-pod → item-po)', !extractCode.includes('"item-po"'));

// --- compileSteps -----------------------------------------------------------------
process.stdout.write('[compileSteps]\n');
const steps = compileSteps(receta, locators, { id: 'TCK-2026-123' });
t('paso 0 type', steps[0], { action: 'type', target: 'role=textbox[name=/Buscar por número/]', value: 'TCK-2026-123' });
t('paso 1 click con plantilla rellena', steps[1], { action: 'click', target: 'span.ticket-number >> text="TCK-2026-123" >> visible=true' });
t('paso 2 wait', steps[2], { action: 'wait', waitFor: 'url', value: '/tickets/' });
// H3: navigate con <- {param} en compileSteps
const navSteps = compileSteps(recipes.get('navegar-a'), locators, { url: 'https://example.com/p1' });
t('H3 compileSteps: navigate value = arg', navSteps[0], { action: 'navigate', value: 'https://example.com/p1' });
// H1: extract locator plano en compileSteps devuelve map con el nombre intacto
t('H1 compileSteps: extract locator plano', navSteps[1], { action: 'extract', map: 'item-pod' });

// --- inyección (ESTRELLA) ---------------------------------------------------------
process.stdout.write('[inyección]\n');
const EVIL = 'x"); fetchEvil(); //';
const evilCode = compileFast(receta, locators, { id: EVIL }); // no debe lanzar
const skeleton = evilCode.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
ok('payload NO aparece fuera de strings (inerte)', !/fetchEvil/.test(skeleton));
ok('código con payload sigue siendo JS parseable', (() => { try { new Function('page', `return (${evilCode})`); return true; } catch { return false; } })());
ok('assertCompiledSafe acepta (payload está encapsulado)', assertCompiledSafe(evilCode) === true);
// y assertCompiledSafe RECHAZA estructura realmente peligrosa:
let threw = false;
try { assertCompiledSafe('async (page) => { require("fs"); }'); } catch { threw = true; }
ok('assertCompiledSafe rechaza require fuera de string', threw);
let threw2 = false;
try { assertCompiledSafe('async (page) => { await page.evaluate(`${x}`); }'); } catch { threw2 = true; }
ok('assertCompiledSafe rechaza template string + page.evaluate', threw2);

// fuzz: varios valores hostiles → siempre inerte y seguro.
process.stdout.write('[fuzz]\n');
let allSafe = true;
for (const v of ['a"b', "a'b", 'a\\b', '${x}', '`x`', 'require("x")', 'A.(B)+', 'TCK-1']) {
  try {
    const c = compileFast(receta, locators, { id: v });
    const sk = c.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
    if (/require|fetchEvil|`/.test(sk)) allSafe = false;
    new Function('page', `return (${c})`); // parseable
  } catch { allSafe = false; }
}
ok('invariante fuzz: todo valor hostil queda inerte y parseable', allSafe);

// --- resumen ----------------------------------------------------------------------
process.stdout.write(`\nrecipe: ${pass} ok, ${fail} fallos\n`);
process.exit(fail === 0 ? 0 : 1);
