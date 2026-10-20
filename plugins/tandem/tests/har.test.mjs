#!/usr/bin/env node
// har.test.mjs — tests for CDP events → HAR 1.2 (scripts/har.mjs), the shape a network-trace
// evaluator (WebArena-Verified) reads. Live recording is covered by a manual e2e (needs Chrome).
// No dependencies: mini-runner. Usage: node tests/har.test.mjs

import { applyResponse, newEntry, parseSetCookie, toHar, toHarEntry, wantsBody } from '../scripts/har.mjs';

let pass = 0; let fail = 0;
function ok(desc, cond) {
  if (cond) { pass++; process.stdout.write(`  ✓ ${desc}\n`); }
  else { fail++; process.stdout.write(`  ✗ ${desc}\n`); }
}
const hdr = (list, name) => list.find((h) => h.name.toLowerCase() === name)?.value;

process.stdout.write('[har]\n');
const post = newEntry({ request: { method: 'POST', url: 'http://s/submit?a=1', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: 'sid=1' }, postData: 'name=bob' }, wallTime: 1700000000, type: 'Document' });
post.extraReqHeaders = { 'content-type': 'application/x-www-form-urlencoded', cookie: 'sid=1', 'sec-fetch-user': '?1', referer: 'http://s/' };
applyResponse(post, { status: 302, statusText: 'Found', headers: { Location: '/done' }, mimeType: '' });
post.extraResHeaders = { Location: '/done', 'Set-Cookie': 'sid=abc; Path=/\ntheme=dark' };
post.redirectURL = 'http://s/done';

const h = toHarEntry(post);
ok('ExtraInfo request headers win (sec-fetch-user present)', hdr(h.request.headers, 'sec-fetch-user') === '?1');
ok('referer kept', hdr(h.request.headers, 'referer') === 'http://s/');
ok('request Cookie redacted by default', hdr(h.request.headers, 'cookie').startsWith('[redacted'));
ok('postData with its mime', h.request.postData.text === 'name=bob' && /urlencoded/.test(h.request.postData.mimeType));
ok('redirect hop: status + redirectURL', h.response.status === 302 && h.response.redirectURL === 'http://s/done');
ok('Set-Cookie (multi-line) → cookie names, values redacted', h.response.cookies.map((c) => c.name).join() === 'sid,theme' && h.response.cookies[0].value === '[redacted]');
ok('queryString parsed', h.request.queryString[0]?.name === 'a');
const hr = toHarEntry(post, { reveal: true });
ok('--reveal keeps cookie values', hr.response.cookies[0].value === 'abc' && hdr(hr.request.headers, 'cookie') === 'sid=1');
ok('parseSetCookie ignores attributes', parseSetCookie({ 'set-cookie': 'a=1; HttpOnly; Secure' })[0].value === '1');
ok('json body wanted, script not', wantsBody({ mimeType: 'application/json', type: 'Fetch' }) && !wantsBody({ mimeType: 'application/json', type: 'Script' }));
ok('html body not fetched', !wantsBody({ mimeType: 'text/html', type: 'Document' }));
ok('HAR envelope', toHar([h]).log.version === '1.2' && toHar([h]).log.entries.length === 1);

process.stdout.write(`\nhar: ${pass} ok, ${fail} failures\n`);
process.exit(fail ? 1 : 0);
