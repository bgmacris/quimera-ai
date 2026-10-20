#!/usr/bin/env node
// cdp-pdf.mjs — PDF (default) or full-page PNG of the tab the human is looking at (no deps, Node 22+).
//
// Page.printToPDF works on headful Chrome now (verified 2026-10-20, Chrome 155) — the old "headless
// only" fallback is gone. The PNG is a full-page capture WITHOUT Emulation.setDeviceMetricsOverride:
// captureBeyondViewport renders the whole page and the human's window is never resized.
// Tab: the visible + focused one (cdp.mjs activePage), or --tab <n>.
// Output on stdout: `pdf:<path>` or `png:<path>`.
//
// Usage: cdp-pdf.mjs [--png] [--output <path>] [--tab <n>] [--landscape] [--no-bg]
//   --png        full-page screenshot instead of PDF (alias: --png-only)

import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { activePage, connect } from './cdp.mjs';
import { dataDir, ensureDataDir } from './paths.mjs';

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
  process.stdout.write('usage: cdp-pdf.mjs [--png] [--output <path>] [--tab <n>] [--landscape] [--no-bg]\n');
  process.exit(0);
}
const png = !!(flags.png || flags['png-only']);

let page; let cdp;
try {
  page = await activePage({ index: flags.tab != null && flags.tab !== true ? +flags.tab : null });
  cdp = await connect(page.webSocketDebuggerUrl, { timeoutMs: 30000 });
} catch (e) {
  process.stderr.write(`cdp-pdf: cannot connect (Chrome active? tandem-browser status).\n  ${e.message}\n`);
  process.exit(1);
}

function outPath(ext) {
  if (typeof flags.output === 'string') return flags.output;
  let host = 'page';
  try { host = new URL(page.url).hostname.replace(/[^a-z0-9.-]/gi, '_') || 'page'; } catch { /* about:blank etc. */ }
  const dir = join(ensureDataDir(dataDir()), 'output');
  mkdirSync(dir, { recursive: true });
  return join(dir, `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${host}.${ext}`);
}

try {
  if (!png) {
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
