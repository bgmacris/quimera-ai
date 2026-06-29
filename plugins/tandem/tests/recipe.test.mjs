#!/usr/bin/env node
// recipe.test.mjs — tests for the recipe compiler (scripts/recipe.mjs).
// No deps: mini-runner + an inline example profile. Covers parsing, validation, --fast/--step
// compilation, template filling with escaping, and — critically — that a hostile value is
// left INERT in the compiled code (browser_run_code_unsafe is RCE-equivalent).
// Usage: node tests/recipe.test.mjs   (exit 0 = green).

import {
  parseProfile, parseRecipes, parseLocators, validate,
  compileFast, compileSteps, fillTemplate, assertCompiledSafe,
} from '../scripts/recipe.mjs';

let pass = 0; let fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function t(d, got, want) { if (eq(got, want)) { pass++; process.stdout.write(`  ✓ ${d}\n`); } else { fail++; process.stdout.write(`  ✗ ${d}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}\n`); } }
function ok(d, c) { if (c) { pass++; process.stdout.write(`  ✓ ${d}\n`); } else { fail++; process.stdout.write(`  ✗ ${d}\n`); } }

const MD = `## Locators (multi-anchor)
- ticket-search:
    sel:       role=textbox[name=/Search by number/]
    primary:   textbox
- ticket-row:
    sel:       span.ticket-number >> text="{id}" >> visible=true
    primary:   row
- row-regex:
    sel:       role=row[name=/^{id}/]
- no-sel:
    primary:   read-only
- item-pod:
    sel:       article.product_pod

## Recipes
open-ticket-by-id(id):
  - type:     ticket-search  <- {id}
  - click:    ticket-row     <- {id}
  - wait-url: /tickets/
  - return:   url

navigate-to(url):
  - navigate: <- {url}
  - extract:  item-pod

bad-action():
  - clik:     ticket-search

missing-locator():
  - click:    no-such-locator

use-no-sel():
  - click:    no-sel

extract-missing-locator():
  - extract:  no-such-locator

navigate-with-hole():
  - navigate: "{url}"

## Other section
- ignore this
`;

// --- parsing ----------------------------------------------------------------------
process.stdout.write('[parsing]\n');
const { locators, recipes } = parseProfile(MD);
ok('parses 5 locators', locators.size === 5);
t('sel of ticket-search', locators.get('ticket-search').sel, 'role=textbox[name=/Search by number/]');
t('detects template (holes)', locators.get('ticket-row').holes, ['id']);
ok('locator with no sel → sel null', locators.get('no-sel').sel === null);
ok('parses 7 recipes', recipes.size === 7);
const recipe = recipes.get('open-ticket-by-id');
t('recipe signature', recipe.params, ['id']);
t('number of steps', recipe.steps.length, 4);
t('type step with param arg', recipe.steps[0], { action: 'type', operand: 'ticket-search', arg: { kind: 'param', name: 'id' } });

// --- fillTemplate (per-engine escaping) -------------------------------------------
process.stdout.write('[fillTemplate]\n');
t('string-engine template', fillTemplate('span.ticket-number >> text="{id}" >> visible=true', { id: 'TCK-2026-123' }), 'span.ticket-number >> text="TCK-2026-123" >> visible=true');
t('regex-engine escapes metacharacters', fillTemplate('role=row[name=/^{id}/]', { id: 'A.B' }), 'role=row[name=/^A\\.B/]');
t('string-engine escapes quotes', fillTemplate('text="{x}"', { x: 'a"b' }), 'text="a\\"b"');

// --- validation -------------------------------------------------------------------
process.stdout.write('[validation]\n');
ok('canonical recipe is valid', validate(recipe, locators).ok);
ok('unknown action detected', !validate(recipes.get('bad-action'), locators).ok);
ok('missing locator detected', !validate(recipes.get('missing-locator'), locators).ok);
ok('locator without sel detected', !validate(recipes.get('use-no-sel'), locators).ok);
const fakeParam = { name: 'x', params: [], steps: [{ action: 'type', operand: 'ticket-search', arg: { kind: 'param', name: 'notdeclared' } }] };
ok('undeclared param detected', !validate(fakeParam, locators).ok);
// H2: extract with missing locator must give error (previously: silent continue)
ok('extract missing locator detected', !validate(recipes.get('extract-missing-locator'), locators).ok);
// H2: extract with valid locator (item-pod) must pass
ok('extract valid locator passes', validate(recipes.get('navigate-to'), locators).ok);
// H2: navigate with {…} in operand without <- generates warning
const navHole = validate(recipes.get('navigate-with-hole'), locators);
ok('navigate with {…} in operand generates warning', navHole.ok && navHole.warnings.length > 0);

// --- compileFast ------------------------------------------------------------------
process.stdout.write('[compileFast]\n');
const code = compileFast(recipe, locators, { id: 'TCK-2026-123' });
ok('is async (page) function', /^async \(page\) => \{/.test(code));
ok('type → fill', code.includes('.fill("TCK-2026-123")'));
ok('click → template filled', code.includes('text=\\"TCK-2026-123\\"') || code.includes('text="TCK-2026-123"'));
ok('wait-url → waitForURL includes', /waitForURL.*includes\("\/tickets\/"\)/.test(code));
ok('return url → page.url()', code.includes('return page.url();'));
ok('passes assertCompiledSafe', assertCompiledSafe(code) === true);
ok('is parseable JS', (() => { try { new Function('page', `return (${code})`); return true; } catch { return false; } })());
// H3: navigate with <- {param} uses the arg value, no double-quoting
const navRecipe = recipes.get('navigate-to');
const navCode = compileFast(navRecipe, locators, { url: 'https://example.com/page-1' });
ok('H3: navigate uses arg (url substituted)', navCode.includes('"https://example.com/page-1"'));
ok('H3: navigate does not double-quote placeholder', !navCode.includes('"{url}"') && !navCode.includes("'{url}'"));
// H1: extract with plain locator — compileFast returns textContent, does not truncate the name
const extractCode = compileFast(navRecipe, locators, { url: 'https://example.com' });
ok('H1: extract plain locator uses correct sel', extractCode.includes('"article.product_pod"'));
ok('H1: locator name not truncated (not item-pod → item-po)', !extractCode.includes('"item-po"'));

// --- compileSteps -----------------------------------------------------------------
process.stdout.write('[compileSteps]\n');
const steps = compileSteps(recipe, locators, { id: 'TCK-2026-123' });
t('step 0 type', steps[0], { action: 'type', target: 'role=textbox[name=/Search by number/]', value: 'TCK-2026-123' });
t('step 1 click with filled template', steps[1], { action: 'click', target: 'span.ticket-number >> text="TCK-2026-123" >> visible=true' });
t('step 2 wait', steps[2], { action: 'wait', waitFor: 'url', value: '/tickets/' });
// H3: navigate with <- {param} in compileSteps
const navSteps = compileSteps(recipes.get('navigate-to'), locators, { url: 'https://example.com/p1' });
t('H3 compileSteps: navigate value = arg', navSteps[0], { action: 'navigate', value: 'https://example.com/p1' });
// H1: plain locator extract in compileSteps returns map with intact name
t('H1 compileSteps: extract plain locator', navSteps[1], { action: 'extract', map: 'item-pod' });

// --- injection (CRITICAL) ---------------------------------------------------------
process.stdout.write('[injection]\n');
const EVIL = 'x"); fetchEvil(); //';
const evilCode = compileFast(recipe, locators, { id: EVIL }); // must not throw
const skeleton = evilCode.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
ok('payload does NOT appear outside strings (inert)', !/fetchEvil/.test(skeleton));
ok('code with payload is still parseable JS', (() => { try { new Function('page', `return (${evilCode})`); return true; } catch { return false; } })());
ok('assertCompiledSafe accepts (payload is encapsulated)', assertCompiledSafe(evilCode) === true);
// and assertCompiledSafe REJECTS genuinely dangerous structure:
let threw = false;
try { assertCompiledSafe('async (page) => { require("fs"); }'); } catch { threw = true; }
ok('assertCompiledSafe rejects require outside string', threw);
let threw2 = false;
try { assertCompiledSafe('async (page) => { await page.evaluate(`${x}`); }'); } catch { threw2 = true; }
ok('assertCompiledSafe rejects template string + page.evaluate', threw2);

// fuzz: various hostile values → always inert and safe.
process.stdout.write('[fuzz]\n');
let allSafe = true;
for (const v of ['a"b', "a'b", 'a\\b', '${x}', '`x`', 'require("x")', 'A.(B)+', 'TCK-1']) {
  try {
    const c = compileFast(recipe, locators, { id: v });
    const sk = c.replace(/"(\\.|[^"\\])*"/g, '""').replace(/'(\\.|[^'\\])*'/g, "''");
    if (/require|fetchEvil|`/.test(sk)) allSafe = false;
    new Function('page', `return (${c})`); // parseable
  } catch { allSafe = false; }
}
ok('fuzz invariant: every hostile value is inert and parseable', allSafe);

// --- summary ----------------------------------------------------------------------
process.stdout.write(`\nrecipe: ${pass} ok, ${fail} failures\n`);
process.exit(fail === 0 ? 0 : 1);
