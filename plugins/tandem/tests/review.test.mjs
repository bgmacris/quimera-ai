#!/usr/bin/env node
// review.test.mjs — regressions for the external review of 2026-10-21 (each case was a confirmed bug
// on 0.6.0): one-line locators dropped, extract maps not validated, extract silently taking the first
// of N, file:/javascript: URLs through --fast, anchored-prefix collisions, injection only on navigate,
// www. twins as separate sites. Usage: node tests/review.test.mjs

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'tandem-rev-'));
process.env.TANDEM_DATA_DIR = TMP;
const { parseLocators, parseRecipes, validate, compileFast, compileSteps } = await import('../scripts/recipe.mjs');
const { unparsedLocatorLines } = await import('../scripts/recipe-parser.mjs');
const { buildSelector } = await import('../scripts/selector.mjs');
const { extractNavigateUrl } = await import('../scripts/map-inject-core.mjs');
const { resolveProfile } = await import('../scripts/profile.mjs');

let pass = 0; let fail = 0;
function ok(desc, cond) { if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); } else { fail++; process.stdout.write(`  ✗ ${desc}\n`); } }
const throws = (f) => { try { f(); return false; } catch { return true; } };

process.stdout.write('[locators]\n');
const ex = readFileSync(new URL('../examples/books.toscrape.com.md', import.meta.url), 'utf8');
const L = parseLocators(ex);
ok('shipped example: all 8 locators parsed (was 3)', L.size === 8);
ok('one-line form, trailing "| verified" dropped', L.get('detail-title')?.sel === '.product_main h1');
ok('one-line form, trailing "(comment)" dropped', L.get('detail-stock')?.sel === '.product_main .availability');
const exCrlf = ex.replace(/\r?\n/g, '\r\n');   // as a Windows checkout (autocrlf) or editor leaves it
ok('CRLF profile: same 8 locators, no trailing \\r in selectors', parseLocators(exCrlf).size === 8 && [...parseLocators(exCrlf).values()].every((v) => !/\r/.test(v.sel)));
ok('CRLF profile: no line reported as unparseable', unparsedLocatorLines(exCrlf).length === unparsedLocatorLines(ex).length);
ok('selector parens kept (:nth-child)', parseLocators('## Locators\n- x:   sel: li:nth-child(2) a   | verified\n').get('x')?.sel === 'li:nth-child(2) a');
ok('unparseable locator lines are reported, not dropped silently', unparsedLocatorLines('## Locators\n- bad line here\n').length === 1);

process.stdout.write('[validate / compile]\n');
const md = `## Locators\n- title:   sel: h1\n- items:   sel: article\n## Recipes\nm(u):\n  - navigate: <- {u}\n  - extract: { t: title, p: missing-loc }\nlist(u):\n  - navigate: <- {u}\n  - extract-all: items\nlocal():\n  - navigate: file:///etc/hostname\n`;
const R = parseRecipes(md); const LL = parseLocators(md);
ok('extract {…} map: unknown locator is caught by validate', !validate(R.get('m'), LL).ok);
ok('navigate literal file:// rejected by validate', !validate(R.get('local'), LL).ok);
ok('navigate ARG file:// rejected (--fast)', throws(() => compileFast(R.get('list'), LL, { u: 'file:///etc/hostname' })));
ok('navigate ARG javascript: rejected (--step)', throws(() => compileSteps(R.get('list'), LL, { u: 'javascript:alert(1)' })));
const code = compileFast(R.get('list'), LL, { u: 'https://ex.com/' });
ok('extract-all → allTextContents (a list)', code.includes('allTextContents()'));
ok('no .first(): single-element reads are strict', !compileFast(parseRecipes('## Recipes\nr():\n  - extract: title\n').get('r'), LL).includes('.first()'));

process.stdout.write('[selector]\n');
ok('anchored id gets \\b (016 ≠ 0161)', buildSelector({ role: 'row', name: 'TCK-2026-016', regex: true, anchor: true }).endsWith('016\\b/]'));

process.stdout.write('[injection trigger]\n');
ok('URL from tool_input (navigate)', extractNavigateUrl({ tool_input: { url: 'https://a.com/x' } }) === 'https://a.com/x');
ok('URL from the result of a click (Page URL line)', extractNavigateUrl({ tool_input: { target: 'x' }, tool_response: [{ type: 'text', text: '### Page\n- Page URL: http://127.0.0.1:8766/\n- Page Title: t' }] }) === 'http://127.0.0.1:8766/');
ok('no URL anywhere → null', extractNavigateUrl({ tool_input: {}, tool_response: 'nothing' }) === null);

process.stdout.write('[www twin]\n');
mkdirSync(join(TMP, 'sites'), { recursive: true });
writeFileSync(join(TMP, 'sites', 'example.com.md'), '# x\n');
ok('www.example.com finds example.com', resolveProfile('https://www.example.com/a')?.path.endsWith('example.com.md'));
writeFileSync(join(TMP, 'sites', 'www.other.org.md'), '# y\n');
ok('other.org finds www.other.org', resolveProfile('https://other.org/')?.path.endsWith('www.other.org.md'));

rmSync(TMP, { recursive: true, force: true });
process.stdout.write(`\nreview: ${pass} ok, ${fail} failures\n`);
process.exit(fail ? 1 : 0);
