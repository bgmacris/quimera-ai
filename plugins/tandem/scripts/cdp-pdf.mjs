#!/usr/bin/env node
// cdp-pdf.mjs — PDF (default) or full-page PNG of the tab the human is looking at (no deps, Node 22+).
//
// Page.printToPDF works on headful Chrome now (verified 2026-10-20, Chrome 155) — the old "headless
// only" fallback is gone. The PNG is a full-page capture WITHOUT Emulation.setDeviceMetricsOverride:
// captureBeyondViewport renders the whole page and the human's window is never resized.
// Tab: the visible + focused one (cdp.mjs activePage), --tab <n>, or --url <url> (the agent's tab: the
// `Page URL` its last result showed).
// Output on stdout: `pdf:<path>`, `png:<path>`, or `pdf-source:<path>`.
//
// A tab that SHOWS a PDF (document.contentType application/pdf) is saved as the original document, not
// printed: printing it gives the viewer's frame ("doc.pdf 1/1"), not the content, and Chrome's viewer is
// opaque to the MCP too (snapshot 0 bytes, find nothing, evaluate an empty body — BOE task, benchmark
// 2026-10-30). The file is then read with Claude Code's Read tool (PDF pages) or pdftotext (--text).
// Since 0.9.7 the launcher saves PDFs as they reach the agent's tab (pdf-capture.mjs); this is for the
// rest: a PDF tab opened before that, or by the human. Bytes from the HTTP cache first
// (Page.getResourceContent: no second request), else a same-URL fetch() in the page, checked to be a PDF. A PDF that came from a POST is in neither (the cache keeps no POST
// response; fetch() re-asks with GET and gets another document): refused, not saved wrong. Chrome's
// viewer holds the bytes, but hands its stream out once (mimeHandlerPrivate.getStreamInfo → undefined
// after it loaded; tried 2026-10-30) — not a route.
//
// Usage: cdp-pdf.mjs [--png] [--output <path>] [--tab <n> | --url <url>] [--landscape] [--no-bg] [--text]
//   --png        full-page screenshot instead of PDF (alias: --png-only)
//   --text       with a PDF tab: also pdftotext -layout next to it (poppler), `text:<path>`

import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { activePage, connect, listPages } from './cdp.mjs';
import { dataDir, ensureDataDir } from './paths.mjs';
import { isMain } from './is-main.mjs';

const isPdf = (buf) => buf.length > 4 && buf.subarray(0, 5).toString('latin1') === '%PDF-';

// The tab whose URL is `url` (hash ignored); a clear error naming the open ones otherwise.
export function pageByUrl(pages, url) {
  const bare = (u) => String(u).replace(/#.*$/, '');
  const hit = pages.find((p) => p.url === url) || pages.find((p) => bare(p.url) === bare(url));
  if (!hit) throw new Error(`no tab on ${url} (open: ${pages.map((p) => p.url).join(', ') || 'none'})`);
  return hit;
}

// The PDF document the tab shows, as { bytes, via }; null if the tab does not show a PDF. Throws when
// it does but the bytes can't be had (a POST response).
export async function pdfSource(cdp) {
  const { result } = await cdp.call('Runtime.evaluate', { expression: '[document.contentType, location.href]', returnByValue: true });
  const [type, href] = result?.value || [];
  if (type !== 'application/pdf') return null;
  try {
    await cdp.call('Page.enable');
    const { frameTree } = await cdp.call('Page.getResourceTree');
    const r = await cdp.call('Page.getResourceContent', { frameId: frameTree.frame.id, url: frameTree.frame.url });
    const bytes = Buffer.from(r.content, r.base64Encoded ? 'base64' : 'latin1');
    if (isPdf(bytes)) return { bytes, via: 'cache' };
  } catch { /* not cached: try fetch */ }
  const r = await cdp.call('Runtime.evaluate', {
    expression: `fetch(location.href, { cache: 'force-cache' }).then(async (res) => {
      const blob = await res.blob();
      const b64 = await new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(',')[1] || ''); f.onerror = ko; f.readAsDataURL(blob); });
      return [res.status, b64];
    })`,
    awaitPromise: true, returnByValue: true,
  });
  // A rejected fetch (network error, revoked blob:) comes back as an exception, not as the array.
  const [status, b64] = !r.exceptionDetails && Array.isArray(r.result?.value) ? r.result.value : [];
  const bytes = Buffer.from(b64 || '', 'base64');
  if (status === 200 && isPdf(bytes)) return { bytes, via: 'fetch' };
  throw new Error(`the tab shows a PDF (${href}) but its bytes are not reachable: not in the HTTP cache, and fetching the URL again `
    + `gives ${status === 200 ? 'another document' : status ? `HTTP ${status}` : 'an error'} — a PDF that came from a form POST, or a blob: whose page is gone. `
    + 'Ask the human to save it (the viewer\'s download button). tandem-intercept and the HAR recorder do not keep binary bodies. '
    + 'Repeating the POST with fetch() from the form page works only if it is harmless to send twice — ask first.');
}

const isCli = isMain(import.meta.url);
if (isCli) {
  // Piped into `grep -q`/`head`: a closed stdout is the reader saying "enough", not an error.
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

  const argv = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true;
  }
  if (flags.help) {
    process.stdout.write('usage: cdp-pdf.mjs [--png] [--output <path>] [--tab <n> | --url <url>] [--landscape] [--no-bg] [--text]\n');
    process.exit(0);
  }
  const png = !!(flags.png || flags['png-only']);

  let page; let cdp;
  try {
    page = typeof flags.url === 'string'
      ? pageByUrl(await listPages(), flags.url)
      : await activePage({ index: flags.tab != null && flags.tab !== true ? +flags.tab : null });
    cdp = await connect(page.webSocketDebuggerUrl, { timeoutMs: 30000 });
  } catch (e) {
    process.stderr.write(`cdp-pdf: cannot connect (Chrome active? tandem-browser status).\n  ${e.message}\n`);
    process.exit(1);
  }

  const outPath = (ext) => {
    if (typeof flags.output === 'string') return flags.output;
    let host = 'page';
    try { host = new URL(page.url).hostname.replace(/[^a-z0-9.-]/gi, '_') || 'page'; } catch { /* about:blank etc. */ }
    const dir = join(ensureDataDir(dataDir()), 'output');
    mkdirSync(dir, { recursive: true });
    return join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${host}.${ext}`);
  };

  try {
    const source = png ? null : await pdfSource(cdp);
    if (source) {
      const p = outPath('pdf'); writeFileSync(p, source.bytes, { mode: 0o600 });
      process.stdout.write(`pdf-source:${p}\n`);
      if (flags.text) {
        const t = p.replace(/\.pdf$/i, '') + '.txt';
        const r = spawnSync('pdftotext', ['-layout', p, t]);
        if (r.error || r.status !== 0) process.stderr.write(`cdp-pdf: no text — pdftotext ${r.error ? 'not found (poppler)' : 'failed'}; read the PDF itself (Claude Code's Read tool reads PDF pages).\n`);
        else process.stdout.write(`text:${t}\n`);
      }
    } else if (!png) {
      const { data } = await cdp.call('Page.printToPDF', { landscape: !!flags.landscape, printBackground: !flags['no-bg'], preferCSSPageSize: true });
      const p = outPath('pdf'); writeFileSync(p, Buffer.from(data, 'base64'), { mode: 0o600 });
      process.stdout.write(`pdf:${p}\n`);
    } else {
      const { cssContentSize } = await cdp.call('Page.getLayoutMetrics');
      const { data } = await cdp.call('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.ceil(cssContentSize.height), scale: 1 },
      });
      const p = outPath('png'); writeFileSync(p, Buffer.from(data, 'base64'), { mode: 0o600 });
      process.stdout.write(`png:${p}\n`);
    }
  } catch (e) {
    process.stderr.write(`cdp-pdf: capture failed: ${e.message}\n`);
    cdp.close(); process.exit(1);
  }
  cdp.close();
}
