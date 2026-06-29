#!/usr/bin/env node
// page-signals.test.mjs — tests for the page fingerprint (scripts/page-signals.mjs).
// No dependencies: mini-runner + a directed MOCK document (no jsdom). Covers:
//   - norm: digits→'#', collapsed spaces, trim, null-safe (the anti-false-drift piece).
//   - collectSignals: roles/landmarks/buttons/inputs/headings/nav-links, dedup + order,
//     and that it normalizes texts (a button 'Order 112' and 'Order 115' give the SAME signal).
//   - consistency: the blob emitted by `print` produces the same result as collectSignals
//     in-process (guarantees that .toString() serialization does not diverge from tested code).
// Usage: node tests/page-signals.test.mjs   (exit 0 = green).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { norm, collectSignals, browserBlob } from '../scripts/page-signals.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0; let fail = 0;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function t(desc, got, want) {
  if (eq(got, want)) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}\n`); }
}

// --- directed MOCK document ---------------------------------------------------------
// map: { '<exact selector>': [ {attributes..., textContent, tagName} ] }. querySelectorAll
// returns an array (has forEach); querySelector returns the first or null. If collectSignals
// changes a selector, it stops receiving nodes → the signal disappears → the test catches it.
function mockDoc(map) {
  const nodeOf = (p) => ({
    getAttribute: (k) => (k in p ? p[k] : null),
    textContent: p.textContent ?? '',
    tagName: p.tagName ?? 'DIV',
  });
  return {
    querySelectorAll: (sel) => (map[sel] || []).map(nodeOf),
    querySelector: (sel) => (map[sel] && map[sel].length ? nodeOf(map[sel][0]) : null),
  };
}

// --- norm -------------------------------------------------------------------------
process.stdout.write('[norm]\n');
t('digits → #', norm('Inbox 112'), 'Inbox #');
t('multiple digit sequences', norm('Order 5 of 200'), 'Order # of #');
t('different counts collapse identically', norm('Inbox 112') === norm('Inbox 115'), true);
t('collapsed spaces + trim', norm('  a   b  '), 'a b');
t('null-safe', norm(null), '');
t('undefined-safe', norm(undefined), '');
t('no digits stays intact', norm('Tickets'), 'Tickets');

// --- collectSignals ---------------------------------------------------------------
process.stdout.write('[collectSignals]\n');
const doc = mockDoc({
  '[role]': [{ role: 'navigation' }, { role: 'button' }],
  header: [{}],
  main: [{}],
  button: [{ 'aria-label': 'Submit' }, { textContent: 'Order 112' }],
  'input,textarea': [{ placeholder: 'Search' }],
  'h1,h2,h3': [{ textContent: 'Tickets 2026', tagName: 'H1' }],
  'nav a,[role=navigation] a': [{ textContent: 'Tickets' }],
});
const sigs = collectSignals(doc);
t('is sorted', eq(sigs, [...sigs].sort()), true);
t('role present', sigs.includes('role:navigation'), true);
t('landmark present (header)', sigs.includes('landmark:header'), true);
t('landmark absent (nav not present)', sigs.includes('landmark:nav'), false);
t('button by aria-label', sigs.includes('button:Submit'), true);
t('button normalized (112→#)', sigs.includes('button:Order #'), true);
t('textbox by placeholder', sigs.includes('textbox:Search'), true);
t('heading with tag + norm', sigs.includes('h1:Tickets #'), true);
t('nav-link', sigs.includes('nav-link:Tickets'), true);

// dedup: two buttons that normalize to the same text → one signal.
const dup = collectSignals(mockDoc({ button: [{ textContent: 'Order 112' }, { textContent: 'Order 999' }] }));
t('dedup after normalizing', dup.filter((s) => s === 'button:Order #').length, 1);

// --- blob consistency (print) vs in-process function ------------------------------
process.stdout.write('[blob print]\n');
// Evaluates the blob by injecting the mock document as `document` in its scope.
const evalBlob = (blob, document) => new Function('document', `return (${blob})();`)(document);
const fromBlob = evalBlob(browserBlob(), doc);
t('blob produces identical result to collectSignals', eq(fromBlob, sigs), true);
// and that the CLI `print` emits that same blob.
const { execFileSync } = await import('node:child_process');
const printed = execFileSync('node', [join(HERE, '..', 'scripts', 'page-signals.mjs'), 'print'], { encoding: 'utf8' }).trim();
t('CLI print == browserBlob()', printed, browserBlob());

// --- summary ----------------------------------------------------------------------
process.stdout.write(`\npage-signals: ${pass} ok, ${fail} failures\n`);
process.exit(fail === 0 ? 0 : 1);
