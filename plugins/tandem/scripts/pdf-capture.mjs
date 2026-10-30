// pdf-capture.mjs — save every PDF the agent's tab receives, as it arrives, POST responses included.
//
// Chrome's PDF viewer is opaque to the browser tools, and the PDF can't be had back afterwards in every
// case: the HTTP cache keeps no POST response, a GET to the same URL returns another document, and the
// Network domain (so HAR and tandem-intercept too) sees the viewer's HTML stub, not the PDF — Chrome swaps
// the body (R07 §2, measured). What does see it is the Fetch domain at the Response stage: the response is
// paused with its headers, Fetch.getResponseBody gives the real bytes, and it goes on to the viewer
// unchanged — the human sees nothing different.
//
// So while the agent's tools run (agent-tab.mjs: the agent's tab only, on during calls + LINGER),
// documents in that tab are intercepted at the Response stage; a 2xx `application/pdf`, or an
// `attachment` named *.pdf, is written to <data>/output/pdf/ and the proxy appends a note to the tool's
// result. Measured (R07): +3 ms per navigation; if this process dies with a response paused, Chrome lets
// it through (no hung tab). The page session already sees iframes (same- and cross-origin), <embed> and
// <object> as documents; a PDF framed INSIDE a cross-origin iframe is another target: child iframes are
// auto-attached (paused until armed; a paused child resumes if this process dies — measured).
//
// `blob:` PDFs never touch the network, and their URL dies with the page that made it (a page that does
// `location.href = blobUrl` takes it along). So URL.createObjectURL is wrapped in the agent's tab: a blob
// typed application/pdf, or an untyped/octet-stream one whose first 5 bytes (a sync Range read) are
// `%PDF-`, is read AT ONCE (sync XHR — the page may navigate next) and handed over through a CDP binding.
// What arrives that way is page-controlled: a blob: URL of the exact form, `%PDF-` bytes, the size cap and
// a per-process count cap are checked before anything is written. The wrapper is a Proxy over the native
// function (toString: `function () { [native code] }`, not the native's `function createObjectURL() …` —
// an exact comparison can still tell), installed while the tab is held. Blobs made in a worker are not
// seen (a worker's blob handed to the page and turned into a URL there is).
// Not covered: PDFs the tab got before the capture was armed (tandem-pdf --url reads GET ones from the
// cache). TANDEM_PDF_CAPTURE=0 turns it off.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LINGER_MS, agentTabHold } from './agent-tab.mjs';
import { extractNavigateUrl, extractPageUrl } from './map-inject-core.mjs';

export const MAX_BYTES = 100 * 1024 * 1024;
export const MAX_BLOB_CAPTURES = 50;
const BINDING = '__tandemPdf';

// Injected in the agent's tab (every new document while held, and the current one).
export const BLOB_HOOK = `(() => {
  if (window.__tandemBlobHook) return; window.__tandemBlobHook = true;
  const send = (url, bin) => { try { if (typeof ${BINDING} === 'function') ${BINDING}(JSON.stringify({ url, b64: btoa(bin) })); } catch {} };
  // Synchronous reads: the page may navigate to the URL next and take the blob with it.
  const read = (url, range) => {
    const x = new XMLHttpRequest(); x.open('GET', url, false);
    if (range) x.setRequestHeader('Range', range);
    x.overrideMimeType('text/plain; charset=x-user-defined'); x.send();
    const t = x.responseText; let bin = ''; for (let i = 0; i < t.length; i++) bin += String.fromCharCode(t.charCodeAt(i) & 0xff);
    return bin;
  };
  const inspect = (obj, url) => {
    if (!(obj instanceof Blob) || obj.size <= 4 || obj.size > ${MAX_BYTES}) return;
    const typed = /^application\\/pdf/i.test(obj.type);
    // untyped/octet-stream: sniff the first 5 bytes only (a Range read: ~12 ms on a 20 MB blob, measured)
    if (typed || ((!obj.type || /octet-stream/i.test(obj.type)) && read(url, 'bytes=0-4') === '%PDF-')) send(url, read(url));
  };
  // A Proxy, not a plain wrapper: toString still says [native code], name and length unchanged.
  URL.createObjectURL = new Proxy(URL.createObjectURL, {
    apply(target, self, args) { const url = Reflect.apply(target, self, args); try { inspect(args[0], url); } catch {} return url; },
  });
})();`;
const BLOB_URL = /^blob:(https?:\/\/[^/\s]{1,253})\/[0-9a-f-]{36}$/i;

const header = (headers, name) => (headers || []).find((h) => h.name.toLowerCase() === name)?.value || '';

// Which paused responses are PDFs to keep (2xx only: an error page served as PDF is rare, a 304 has no body).
export function isPdfResponse({ responseStatusCode: status, responseHeaders: headers }) {
  if (!(status >= 200 && status < 300)) return false;
  if (/application\/pdf/i.test(header(headers, 'content-type'))) return true;
  const cd = header(headers, 'content-disposition');
  return /attachment/i.test(cd) && /\.pdf\b/i.test(cd);
}

// A file name from Content-Disposition, else the URL's last path segment; never a path.
export function pdfFileName(url, headers, now = new Date()) {
  const cd = header(headers, 'content-disposition');
  let name = (cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i)?.[1] || cd.match(/filename="?([^";]+)"?/i)?.[1] || '').trim();
  try { name = decodeURIComponent(name); } catch { /* keep as is */ }
  let host = 'page';
  try {
    const u = new URL(url);
    host = u.hostname || host;
    if (!name) name = decodeURIComponent(u.pathname.split('/').pop() || '');
  } catch { /* not a URL */ }
  const safe = (s) => s.replace(/[^\w.\-]+/g, '_').replace(/^\.+/, '').slice(0, 80);
  name = safe(name.replace(/\.pdf$/i, '')) || 'document';
  return `${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${safe(host)}-${name}.pdf`;
}

export function pdfCapturer({ port, outDir, lingerMs = DEFAULT_LINGER_MS, budgetMs = 500, log = () => {}, maxBytes = MAX_BYTES }) {
  const pending = [];        // notes not yet added to a result
  const captured = new Set(); // URLs captured (this process): no "not captured" hint for them, no duplicates
  const hinted = new Set();
  let blobs = 0;

  function save({ method, url, name, bytes, from }) {
    mkdirSync(outDir, { recursive: true });
    const path = join(outDir, name);
    writeFileSync(path, bytes, { mode: 0o600 });
    captured.add(url);
    pending.push(`### tandem: PDF captured\n- ${from || `${method} ${url}`}\n- saved to ${path} (${bytes.length} bytes)\n`
      + "- Chrome's PDF viewer is opaque to the browser tools: read this file instead — the Read tool (pages as images: "
      + 'tables, figures, scans; pages: "1-5"), or `pdftotext -layout` for exact, searchable text. Long PDF: text first, grep, then Read only the pages that matter.');
  }

  async function onPaused(c, p, sessionId) {
    try {
      if (!isPdfResponse(p)) return;
      const len = Number(header(p.responseHeaders, 'content-length'));
      if (len > maxBytes) { pending.push(`tandem: a PDF arrived in your tab (${p.request.url}) but it is ${len} bytes, over the capture limit; it was not saved.`); return; }
      const r = await c.call('Fetch.getResponseBody', { requestId: p.requestId }, sessionId);
      const bytes = Buffer.from(r.body, r.base64Encoded ? 'base64' : 'utf8');
      if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') { log(`pdf: ${p.request.url} is not a PDF (${bytes.length} B)`); return; }
      save({ method: p.request.method, url: p.request.url, name: pdfFileName(p.request.url, p.responseHeaders), bytes });
    } catch (e) { log(`pdf: ${e.message}`); } finally {
      // Always let the response through: a paused document is a hung tab.
      c.call('Fetch.continueRequest', { requestId: p.requestId }, sessionId).catch(() => {});
    }
  }

  // Page-controlled input: anything the page calls the binding with lands here.
  function onBlob(payload) {
    try {
      if (blobs >= MAX_BLOB_CAPTURES || payload.length > maxBytes * 1.4) return;
      const { url, b64 } = JSON.parse(payload);
      const origin = typeof url === 'string' && url.match(BLOB_URL)?.[1];
      if (!origin || captured.has(url) || typeof b64 !== 'string') return;
      const bytes = Buffer.from(b64, 'base64');
      if (bytes.length > maxBytes || bytes.subarray(0, 5).toString('latin1') !== '%PDF-') return;
      blobs++;
      save({ url, name: pdfFileName(`${origin}/blob.pdf`, []), bytes, from: `a blob: PDF made by the page (${origin})` });
    } catch (e) { log(`pdf blob: ${e.message}`); }
  }

  // What every held session (the tab, and its child iframes) gets.
  // A child waiting for the debugger has no document yet, and a Runtime.evaluate on it doesn't answer until
  // it runs (measured: the agent's call hung) — children get only what applies before they start.
  async function arm(c, sessionId, { child = false } = {}) {
    await c.call('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Response' }] }, sessionId);
    await c.call('Runtime.enable', {}, sessionId);
    await c.call('Runtime.addBinding', { name: BINDING }, sessionId);
    await c.call('Page.enable', {}, sessionId).catch(() => {});
    await c.call('Page.addScriptToEvaluateOnNewDocument', { source: BLOB_HOOK }, sessionId).catch(() => {});
    if (!child) await c.call('Runtime.evaluate', { expression: BLOB_HOOK }, sessionId).catch(() => {});
    await c.call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true, filter: [{ type: 'iframe', exclude: false }] }, sessionId).catch(() => {});
  }

  const hold = agentTabHold({
    port, lingerMs, budgetMs, log, label: 'pdf', callTimeoutMs: 30_000,   // a 100 MB getResponseBody takes seconds
    onClient: (c) => {
      c.on('Fetch.requestPaused', (p, sessionId) => { onPaused(c, p, sessionId); });
      c.on('Runtime.bindingCalled', (p) => { if (p.name === BINDING) onBlob(String(p.payload || '')); });
      // A child iframe of a held tab: arm it, then let it run (it waits for us until then).
      // A child iframe of a held tab waits for us (waitForDebuggerOnStart): arm it, then ALWAYS let it run —
      // a child left paused is a page that never finishes loading and an agent call that never returns.
      // Chrome's own frames (the PDF viewer's chrome-extension:// iframe) are not armed, only resumed.
      // Only auto-attached children carry their parent's session; our own attachToTarget echoes here too.
      c.on('Target.attachedToTarget', async (p, parent) => {
        if (!parent) return;
        const url = p.targetInfo?.url || '';
        try { if (!/^(chrome|chrome-extension|devtools):/.test(url)) await arm(c, p.sessionId, { child: true }); }
        catch (e) { log(`pdf child ${url}: ${e.message}`); }
        finally { if (p.waitingForDebugger) c.call('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {}); }
      });
    },
    onAttach: (c, sessionId) => arm(c, sessionId),
  });

  return {
    ...hold,
    get held() { return hold.held; },
    // Notes for this result: captures so far, and — when the tab shows a .pdf that was not captured (it
    // was open before the capture armed) — how to get it, once per URL.
    notes(name, args, result) {
      const out = pending.splice(0);
      const url = extractPageUrl({ tool_name: name, tool_input: args || {}, tool_response: result })
        || extractNavigateUrl({ tool_name: name, tool_input: args || {}, tool_response: result });
      let isPdfUrl = false;
      try { isPdfUrl = /\.pdf$/i.test(new URL(url).pathname); } catch { /* no URL */ }
      if (isPdfUrl && !captured.has(url) && !hinted.has(url)) {
        hinted.add(url);
        const q = url.replace(/'/g, "'\\''");   // inside the single quotes of the shell line below
        out.push(`tandem: this tab shows a PDF (${url}) that was not captured as it arrived. Chrome's PDF viewer is opaque to the browser tools; save the original with Bash \`tandem-pdf --url '${q}'\` (from Chrome's cache) and read the file with the Read tool or pdftotext.`);
      }
      return out;
    },
  };
}
