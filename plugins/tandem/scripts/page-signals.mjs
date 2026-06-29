#!/usr/bin/env node
// page-signals.mjs — single source of truth for tandem:map page fingerprint (T015).
//
// The "canonical evaluate" that extracts the STRUCTURAL SKELETON of a page (roles, landmarks,
// buttons, inputs, headings, nav-links) lived as a prose snippet inside skills/map. Problem:
// that algorithm is CRITICAL — changing it invalidates ALL saved fingerprints (false drift
// everywhere) — but its only source was hand-typed markdown. Here it becomes versioned and
// testable code, with a single definition of the algorithm.
//
// Two consumers, one source:
//   - node (test): imports { norm, collectSignals } and exercises them in-process.
//   - browser: `page-signals.mjs print` emits a SELF-CONTAINED blob `() => [...]` ready to
//     paste into browser_evaluate. The blob is SERIALIZED from these same functions (.toString()),
//     so it cannot diverge from the tested code.
//
// `norm`: normalizes a string so that counts/dates/ids do NOT count as drift —
// collapses spaces, trims, and reduces each digit sequence to '#'
// ('Inbox 112' and 'Inbox 115' → 'Inbox #'). This is the piece that prevents false drift.

export const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().replace(/\d+/g, '#').replace(/[\x00-\x1F\x7F]/g, '').slice(0, 120);

// collectSignals(document[, normFn]): SORTED set of structural signals for the page.
// normFn is a parameter (default: norm) so the browser blob can inject the serialized norm
// and the function is truly self-contained.
export function collectSignals(document, normFn = norm) {
  const sig = new Set();
  document.querySelectorAll('[role]').forEach((e) => { const r = e.getAttribute('role'); if (r) sig.add('role:' + r); });
  ['header', 'nav', 'main', 'aside', 'footer', 'form'].forEach((t) => { if (document.querySelector(t)) sig.add('landmark:' + t); });
  document.querySelectorAll('button').forEach((b) => { const n = normFn(b.getAttribute('aria-label') || b.textContent); if (n) sig.add('button:' + n); });
  document.querySelectorAll('input,textarea').forEach((i) => { const n = normFn(i.getAttribute('placeholder') || i.getAttribute('aria-label') || ''); if (n) sig.add('textbox:' + n); });
  document.querySelectorAll('h1,h2,h3').forEach((h) => { const n = normFn(h.textContent); if (n) sig.add(h.tagName.toLowerCase() + ':' + n); });
  document.querySelectorAll('nav a,[role=navigation] a').forEach((a) => { const n = normFn(a.textContent); if (n) sig.add('nav-link:' + n); });
  return [...sig].sort();
}

// Self-contained blob for browser_evaluate. Injects the REAL norm (serialized) into scope and
// calls collectSignals with the browser's global document. Single arrow, no imports.
export function browserBlob() {
  return `() => {\n  const norm = ${norm.toString()};\n  const collectSignals = ${collectSignals.toString()};\n  return collectSignals(document, norm);\n}`;
}

// --- CLI: `page-signals.mjs print` -------------------------------------------------
import { fileURLToPath } from 'node:url';
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  if (process.argv[2] === 'print') {
    process.stdout.write(browserBlob() + '\n');
    process.exit(0);
  }
  process.stderr.write('usage: page-signals.mjs print   (emits the blob for browser_evaluate)\n');
  process.exit(2);
}
