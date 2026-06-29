#!/usr/bin/env node
// selector.test.mjs — tests for the Playwright selector generator (scripts/selector.mjs).
// No dependencies: mini-runner. Covers the escapes that are error-prone when typed by hand
// (the raison d'être of the helper): quotes in name, metacharacters in regex mode, the '/'
// delimiter, anchoring, unicode/accents, the template case (concrete id), and that everything
// generated passes isWellFormed.
// Usage: node tests/selector.test.mjs   (exit 0 = green).

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

// --- string mode (exact name) -----------------------------------------------------
process.stdout.write('[string]\n');
t('basic', buildSelector({ role: 'button', name: 'New ticket' }), 'role=button[name="New ticket"]');
t('double quote escaped', buildSelector({ role: 'button', name: 'Search "tickets"' }), 'role=button[name="Search \\"tickets\\""]');
t('backslash escaped', buildSelector({ role: 'link', name: 'a\\b' }), 'role=link[name="a\\\\b"]');
t('accents untouched', buildSelector({ role: 'textbox', name: 'Valid date' }), 'role=textbox[name="Valid date"]');
t('apostrophe unescaped (double quotes)', buildSelector({ role: 'cell', name: "N.º d'ordre" }), 'role=cell[name="N.º d\'ordre"]');
t('no name → bare role', buildSelector({ role: 'navigation', name: '' }), 'role=navigation');
t('null name → bare role', buildSelector({ role: 'main' }), 'role=main');

// --- regex mode (substring, robust for long/dynamic names) ------------------------
process.stdout.write('[regex]\n');
t('simple substring', buildSelector({ role: 'textbox', name: 'Search by number', regex: true }), 'role=textbox[name=/Search by number/]');
t('metacharacters escaped', buildSelector({ role: 'textbox', name: 'N.º (1)', regex: true }), 'role=textbox[name=/N\\.º \\(1\\)/]');
t('slash delimiter escaped', buildSelector({ role: 'link', name: 'a/b', regex: true }), 'role=link[name=/a\\/b/]');
// hyphen outside [...] is literal in regex → NOT escaped (would be noise).
t('anchor at start (template with concrete id)', buildSelector({ role: 'row', name: 'TCK-2026-016', regex: true, anchor: true }), 'role=row[name=/^TCK-2026-016/]');
t('anchor without regex is ignored (string mode)', buildSelector({ role: 'button', name: 'X', anchor: true }), 'role=button[name="X"]');

// --- unit escapes -----------------------------------------------------------------
process.stdout.write('[escapes]\n');
t('escapeStringName quotes', escapeStringName('say "hello"'), 'say \\"hello\\"');
t('escapeRegexName dots/parens', escapeRegexName('v1.2 (beta)'), 'v1\\.2 \\(beta\\)');
t('escapeRegexName slash', escapeRegexName('a/b'), 'a\\/b');

// --- well-formed / errors ---------------------------------------------------------
process.stdout.write('[well-formed / errors]\n');
ok('generated string is well-formed', isWellFormed(buildSelector({ role: 'button', name: 'Save "now"' })));
ok('generated regex is well-formed', isWellFormed(buildSelector({ role: 'row', name: 'TCK-1', regex: true, anchor: true })));
ok('bare role is well-formed', isWellFormed('role=main'));
ok('detects unclosed bracket', !isWellFormed('role=button[name="x"'));
ok('detects unclosed quote', !isWellFormed('role=button[name="x]'));
ok('detects unclosed regex', !isWellFormed('role=row[name=/^x]'));
ok('empty string is not well-formed', !isWellFormed(''));
let threw = false;
try { buildSelector({ name: 'no role' }); } catch { threw = true; }
ok('throws if role is missing', threw);

// invariant: everything buildSelector generates with non-empty name passes isWellFormed.
const fuzz = ['Hello', 'a"b', 'a\\b', 'N.º (1)', 'a/b/c', 'TCK-2026-016', "d'ord"];
let allWF = true;
for (const n of fuzz) {
  for (const rx of [false, true]) {
    if (!isWellFormed(buildSelector({ role: 'x', name: n, regex: rx, anchor: rx }))) { allWF = false; }
  }
}
ok('invariant: every generated selector is well-formed', allWF);

// --- summary ----------------------------------------------------------------------
process.stdout.write(`\nselector: ${pass} ok, ${fail} failures\n`);
process.exit(fail === 0 ? 0 : 1);
