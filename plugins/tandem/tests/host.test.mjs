#!/usr/bin/env node
// host.test.mjs — tests for single host normalization (scripts/host.mjs).
// No dependencies: mini-runner. host.mjs is the single source that recipe/fingerprint/hook/map
// use to convert "URL or host" → store key; a bug here = path traversal or divergent key.
// Covers: URLs and bare hosts, uppercase scheme (fixed bug), userinfo/port, IDN→punycode,
// and — critically — that everything hostile (traversal, empty, non-ASCII, IPv6) is REJECTED.
// Usage: node tests/host.test.mjs   (exit 0 = green).

import { normalizeHost, hostOf } from '../scripts/host.mjs';

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
t('userinfo dropped, non-default port kept as _port', normalizeHost('http://user:pass@example.es:8443/path'), 'example.es_8443');
t('bare host:port → host_port', normalizeHost('foo.com:8080'), 'foo.com_8080');
t('default port in URL → no port (https:443)', normalizeHost('https://example.com:443/x'), 'example.com');
t('default port in URL → no port (http:80)', normalizeHost('http://example.com:80/x'), 'example.com');
t('bare :443 treated as default', normalizeHost('example.com:443'), 'example.com');
t('localhost app on its port', normalizeHost('http://localhost:5184/clients'), 'localhost_5184');
t('a key round-trips (host_port)', normalizeHost('localhost_5184'), 'localhost_5184');
t('hostOf strips the port', hostOf('localhost_5184'), 'localhost');
t('hostOf of a plain host', hostOf('books.toscrape.com'), 'books.toscrape.com');
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
rejects('port out of range', 'localhost:99999');
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
  if (h.includes('/') || h.includes('..') || h !== h.toLowerCase() || !/^[a-z0-9.-]+(_\d+)?$/.test(h)) safe = false;
}
ok('invariant: every valid output is [a-z0-9.-] (+ optional _port), no / or ..', safe);

// --- summary ----------------------------------------------------------------------
process.stdout.write(`\nhost: ${pass} ok, ${fail} failures\n`);
process.exit(fail === 0 ? 0 : 1);
