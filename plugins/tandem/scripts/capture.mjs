// capture.mjs — network capture engine over ALL tabs (shared by cdp-record and cdp-intercept).
//
// Browser-level Target.setAutoAttach {flatten:true}: existing and future page targets (new tabs,
// popups) over one connection, without colliding with Playwright's. Emits one raw hop per finished
// request (har.mjs newEntry shape); callers turn it into HAR or NDJSON.
//
// Fidelity rules (see har.mjs): each redirect hop is its own entry; ExtraInfo headers win; a
// redirect hop's responseReceivedExtraInfo can arrive AFTER the next hop started (observed 3 of 4
// runs) — it carries its statusCode and is matched to that hop. So that streaming consumers (NDJSON)
// get the late headers too, a finished hop is emitted only after EMIT_GRACE_MS.
//
// Known limit: a tab created PROGRAMMATICALLY with its URL (Target.createTarget({url})) loses its
// first document request — that navigation is browser-initiated and leaves before the tab can be
// attached. Clicks, target=_blank links, typing in an existing tab and Playwright's browser_tabs new
// (about:blank, then goto) are captured (verified in tests/e2e.sh and with the MCP attached).

import { applyResponse, newEntry } from './har.mjs';

export const EMIT_GRACE_MS = 1500;

// opts: { onEntry(raw), wantsBody(raw) → bool, bodyCap, extraHeader: [name, value] | null }
export async function startCapture(cdp, { onEntry, wantsBody = () => false, bodyCap = 32 * 1024, extraHeader = null }) {
  const live = new Map(); const finished = []; const extraReq = new Map(); const extraRes = new Map();
  const inflight = new Set();
  const key = (s, id) => `${s || 'root'}:${id}`;

  function finish(k, e) { live.delete(k); e.key = k; e.finishedAt = Date.now(); finished.push(e); }
  function flush(all = false) {
    const now = Date.now();
    while (finished.length && (all || now - finished[0].finishedAt >= EMIT_GRACE_MS)) onEntry(finished.shift());
  }
  const timer = setInterval(() => flush(false), 250);

  // Send enable + resume TOGETHER, without awaiting enable first: a paused target does not answer
  // Network.enable until it runs (awaiting it = deadlock: the new tab stayed at about:blank). CDP
  // executes a session's commands in order, so capture is on before the target resumes.
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    const cmds = [];
    if (targetInfo.type === 'page') {
      cmds.push(cdp.call('Network.enable', { maxPostDataSize: 65536 }, sessionId));
      if (extraHeader) cmds.push(cdp.call('Network.setExtraHTTPHeaders', { headers: { [extraHeader[0]]: extraHeader[1] } }, sessionId));
    }
    cmds.push(cdp.call('Runtime.runIfWaitingForDebugger', {}, sessionId));
    Promise.allSettled(cmds);   // target may vanish mid-way: nothing to recover
  });

  cdp.on('Network.requestWillBeSent', ({ requestId, request, redirectResponse, wallTime, type }, s) => {
    const k = key(s, requestId); const prev = live.get(k);
    if (redirectResponse && prev) {           // close the previous hop as its own 3xx entry
      applyResponse(prev, redirectResponse);
      prev.redirectURL = request.url;
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
    const k = key(s, requestId); const e = live.get(k); if (!e) return;
    applyResponse(e, response);
    if (extraRes.has(k)) { e.extraResHeaders = extraRes.get(k); extraRes.delete(k); }
  });
  cdp.on('Network.responseReceivedExtraInfo', ({ requestId, headers, statusCode }, s) => {
    const k = key(s, requestId);
    if (statusCode >= 300 && statusCode < 400) {
      const hop = finished.findLast((d) => d.key === k && d.status === statusCode && !d.extraResHeaders);
      if (hop) { hop.extraResHeaders = headers; return; }
    }
    const e = live.get(k);
    if (e && e.status) e.extraResHeaders = headers; else extraRes.set(k, headers);
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
          if (base64Encoded) e.body = `[binary: ${Math.floor((body?.length || 0) * 3 / 4)} bytes]`;
          else if (body) e.body = body.length > bodyCap ? `${body.slice(0, bodyCap)}…[+${body.length - bodyCap}b]` : body;
        } catch { /* evicted */ }
      }
      finish(k, e);
    })();
    inflight.add(p); p.finally(() => inflight.delete(p));
  });
  cdp.on('Network.loadingFailed', ({ requestId }, s) => {
    const k = key(s, requestId); const e = live.get(k); if (e) finish(k, e);
  });

  // New tabs start PAUSED until Network is enabled (and the extra header set): otherwise their FIRST
  // request — the document itself — is sent before we listen (seen: a new tab recorded only its
  // favicon). Runtime.runIfWaitingForDebugger in the attach handler resumes them.
  await cdp.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const { targetInfos } = await cdp.call('Target.getTargets');
  for (const t of targetInfos.filter((t) => t.type === 'page' && !t.attached)) {
    cdp.call('Target.attachToTarget', { targetId: t.targetId, flatten: true }).catch(() => {});
  }

  return {
    // Wait (bounded) for in-flight bodies, emit answered-but-unfinished hops (streams), flush all.
    async stop() {
      await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, 3000))]);
      for (const [k, e] of live) if (e.status) finish(k, e);
      clearInterval(timer); flush(true);
    },
  };
}
