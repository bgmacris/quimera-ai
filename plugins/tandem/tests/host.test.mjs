#!/usr/bin/env node
// host.test.mjs — tests for single host normalization (scripts/host.mjs).
// No dependencies: mini-runner. host.mjs is the single source that recipe/fingerprint/hook/map
// use to convert "URL or host" → store key; a bug here = path traversal or divergent key.
// Covers: URLs and bare hosts, uppercase scheme (fixed bug), userinfo/port, IDN→punycode,
// and — critically — that everything hostile (traversal, empty, non-ASCII, IPv6) is REJECTED.
// Usage: node tests/host.test.mjs   (exit 0 = green).

import { normalizeHost } from '../scripts/host.mjs';

let pass = 0; let fail = 0;
function t(desc, got, want) {
  if (got === want) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}\n`); }
}
function ok(desc, cond) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n`); }
}
function rejects(desc, input) {
  let threw = false;
  try { normalizeHost(input); } catch { threw = true; }
  ok(desc, threw);
}

// --- valid hosts and URLs ---------------------------------------------------------
process.stdout.write('[valid]\n');
t('bare host intact', normalizeHost('books.toscrape.com'), 'books.toscrape.com');
t('full URL → host', normalizeHost('https://books.toscrape.com/cat/page-1.html'), 'books.toscrape.com');
t('uppercase scheme + mixed host (bug fixed)', normalizeHost('HTTPS://Foo.COM/x'), 'foo.com');
t('userinfo and port discarded', normalizeHost('http://user:pass@example.es:8443/path'), 'example.es');
t('bare host:port → no port', normalizeHost('foo.com:8080'), 'foo.com');
t('bare host with path', normalizeHost('example.com/foo/bar'), 'example.com');
t('subdomains preserved', normalizeHost('https://a.b.c.example.org/'), 'a.b.c.example.org');
t('IDN in URL → punycode', normalizeHost('https://café.com'), 'xn--caf-dma.com');
t('already lowercase and idempotent', normalizeHost(normalizeHost('https://X.EXAMPLE.com')), 'x.example.com');

// --- hostile: must throw (without this, path traversal or garbage key) -------------
process.stdout.write('[rejections]\n');
rejects('traversal with slashes', '../../etc/passwd');
rejects('only two dots', '..');
rejects('empty string', '');
rejects('only spaces', '   ');
rejects('internal spaces', 'a b');
rejects('bare non-ASCII host (no scheme to punycode it)', 'café.com');
rejects('IPv6 literal (not a valid filename key)', 'https://[::1]:9222');
rejects('non-string (number)', 123);
rejects('non-string (null)', null);

// --- security invariant: nothing that comes OUT can traverse ----------------------
process.stdout.write('[invariant]\n');
const valid = [
  'books.toscrape.com', 'https://a.b.c.example.org/x?y=1', 'HTTP://Z.com:99/p',
  'http://u@host.io/path', 'sub.domain.es',
];
let safe = true;
for (const v of valid) {
  const h = normalizeHost(v);
  if (h.includes('/') || h.includes('..') || h !== h.toLowerCase() || !/^[a-z0-9.-]+$/.test(h)) safe = false;
}
ok('invariant: every valid output is [a-z0-9.-], no / or ..', safe);

// --- summary ----------------------------------------------------------------------
process.stdout.write(`\nhost: ${pass} ok, ${fail} failures\n`);
process.exit(fail === 0 ? 0 : 1);
