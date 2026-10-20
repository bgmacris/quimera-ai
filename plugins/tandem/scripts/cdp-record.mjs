#!/usr/bin/env node
// cdp-record.mjs — record ALL tabs of tandem's Chrome to a HAR file (no deps, Node 22+).
//
// Attaches at the BROWSER endpoint with Target.setAutoAttach {flatten:true}: every existing and
// future page target (new tabs, popups) is captured over one connection, without colliding with
// Playwright's. Ends on SIGTERM/SIGINT or --duration; then waits for in-flight bodies and writes
// the HAR (0600). Built for network-trace evaluation (e.g. WebArena-Verified) — see har.mjs.
//
// Usage: cdp-record.mjs --out <file.har> [--duration <s>] [--reveal] [--extra-header "Name: value"]
//   --reveal         keep credential headers/cookie values (default: redacted)
//   --extra-header   add a request header on every attached page (e.g. a test env's auto-login)
// Prints "recording" on stderr once attached (a runner can wait for it).

import { writeFileSync } from 'node:fs';
import { browserWsUrl, connect } from './cdp.mjs';
import { BODY_CAP, applyResponse, newEntry, toHar, toHarEntry, wantsBody } from './har.mjs';

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true;
}
if (!flags.out || flags.out === true) {
  process.stderr.write('usage: cdp-record.mjs --out <file.har> [--duration <s>] [--reveal] [--extra-header "Name: value"]\n');
  process.exit(2);
}
const reveal = !!flags.reveal;
const extra = typeof flags['extra-header'] === 'string' ? flags['extra-header'].split(/:\s*/) : null;

let cdp;
try { cdp = await connect(await browserWsUrl()); } catch (e) {
  process.stderr.write(`cdp-record: cannot connect (Chrome active? tandem-browser status).\n  ${e.message}\n`);
  process.exit(1);
}

const live = new Map();   // `${session}:${requestId}` → in-flight entry
const done = [];          // finished hops (raw), in completion order; converted to HAR at stop
const extraReq = new Map(); const extraRes = new Map();  // ExtraInfo may arrive before its request
const inflight = new Set();
const key = (s, id) => `${s || 'root'}:${id}`;

function finish(k, e) { live.delete(k); e.key = k; done.push(e); }

cdp.on('Target.attachedToTarget', async ({ sessionId, targetInfo }) => {
  if (targetInfo.type !== 'page') {
    cdp.call('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
    return;
  }
  try {
    await cdp.call('Network.enable', { maxPostDataSize: 65536 }, sessionId);
    if (extra) await cdp.call('Network.setExtraHTTPHeaders', { headers: { [extra[0]]: extra.slice(1).join(':') } }, sessionId);
  } catch { /* target vanished */ }
  cdp.call('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
});

cdp.on('Network.requestWillBeSent', ({ requestId, request, redirectResponse, wallTime, type }, s) => {
  const k = key(s, requestId);
  const prev = live.get(k);
  if (redirectResponse && prev) {           // close the previous hop as its own 3xx entry
    applyResponse(prev, redirectResponse);
    prev.redirectURL = request.url;
    // A redirect hop gets no responseReceived: its raw headers (Set-Cookie) only come via ExtraInfo.
    if (extraRes.has(k)) { prev.extraResHeaders = extraRes.get(k); extraRes.delete(k); }
    finish(k, prev);
  }
  const e = newEntry({ request, wallTime, type });
  if (extraReq.has(k)) { e.extraReqHeaders = extraReq.get(k); extraReq.delete(k); }
  live.set(k, e);
});
cdp.on('Network.requestWillBeSentExtraInfo', ({ requestId, headers }, s) => {
  const e = live.get(key(s, requestId));
  if (e && !e.extraReqHeaders) e.extraReqHeaders = headers; else extraReq.set(key(s, requestId), headers);
});
cdp.on('Network.responseReceived', ({ requestId, response }, s) => {
  const e = live.get(key(s, requestId)); if (!e) return;
  applyResponse(e, response);
  if (extraRes.has(key(s, requestId))) { e.extraResHeaders = extraRes.get(key(s, requestId)); extraRes.delete(key(s, requestId)); }
});
cdp.on('Network.responseReceivedExtraInfo', ({ requestId, headers, statusCode }, s) => {
  const k = key(s, requestId);
  // A redirect hop's ExtraInfo can arrive AFTER the next hop started (observed: 3 of 4 runs).
  // It carries its statusCode: give it to the last finished 3xx hop of this request still lacking it.
  if (statusCode >= 300 && statusCode < 400) {
    const hop = done.findLast((d) => d.key === k && d.status === statusCode && !d.extraResHeaders);
    if (hop) { hop.extraResHeaders = headers; return; }
  }
  const e = live.get(k);
  if (e && e.status) e.extraResHeaders = headers; else extraRes.set(key(s, requestId), headers);
});
cdp.on('Network.loadingFinished', ({ requestId }, s) => {
  const k = key(s, requestId); const e = live.get(k); if (!e) return;
  const p = (async () => {
    if (e.hasPostData && e.postData == null) {
      try { e.postData = (await cdp.call('Network.getRequestPostData', { requestId }, s)).postData; } catch { /* gone */ }
    }
    if (wantsBody(e)) {
      try {
        const { body, base64Encoded } = await cdp.call('Network.getResponseBody', { requestId }, s);
        if (!base64Encoded && body) e.body = body.slice(0, BODY_CAP);
      } catch { /* evicted */ }
    }
    finish(k, e);
  })();
  inflight.add(p); p.finally(() => inflight.delete(p));
});
cdp.on('Network.loadingFailed', ({ requestId }, s) => {
  const k = key(s, requestId); const e = live.get(k); if (e) finish(k, e);
});

// With an extra header, new tabs start PAUSED until it is set (else their first request goes without it).
await cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: !!extra, flatten: true });
// setAutoAttach on the browser covers new targets; attach explicitly to pages that already exist.
const { targetInfos } = await cdp.call('Target.getTargets');
for (const t of targetInfos.filter((t) => t.type === 'page' && !t.attached)) {
  cdp.call('Target.attachToTarget', { targetId: t.targetId, flatten: true }).catch(() => {});
}
process.stderr.write('cdp-record: recording\n');

let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, 3000))]);
  for (const [k, e] of live) if (e.status) finish(k, e);   // answered but never "finished" (streams)
  writeFileSync(flags.out, JSON.stringify(toHar(done.map((e) => toHarEntry(e, { reveal }))), null, 1) + '\n', { mode: 0o600 });
  process.stderr.write(`cdp-record: ${done.length} entries → ${flags.out}\n`);
  cdp.close(); process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
cdp.onClose(() => stop());
if (flags.duration) setTimeout(stop, +flags.duration * 1000);
