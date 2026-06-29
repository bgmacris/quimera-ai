#!/usr/bin/env node
// cdp-pdf.mjs — generates PDF or full-page screenshot of the active tab via CDP (no deps, Node 22+).
//
// Tries Page.printToPDF (only works if Chrome was launched with --headless). If it fails,
// automatic fallback to Page.captureScreenshot full-page (always works in tandem).
// The generated file and its format are printed on stdout for the agent to use.
//
// Usage: cdp-pdf.mjs [--output <path>] [--tab <n>] [--landscape] [--no-bg] [--png-only]
//   --output <path>   explicit output path (.pdf or .png depending on what is generated)
//   --tab <n>         tab index to capture (default 0)
//   --landscape       landscape orientation (PDF only)
//   --no-bg           no background colors (PDF only)
//   --png-only        skip PDF attempt, go straight to screenshot

import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// --- config -----------------------------------------------------------------------
function cdpPort() {
  const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
  try { return +readFileSync(join(dataDir, 'cdp-port'), 'utf8').trim() || 9222; }
  catch { return +(process.env.TANDEM_CDP_PORT || 9222); }
}
function outputDir() {
  const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
  return join(dataDir, 'output');
}

// --- CDP client -------------------------------------------------------------------
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (e) => reject(new Error(String(e.message || e))));
  });
}
let _id = 0;
function cdpCall(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++_id;
    const handler = ({ data }) => {
      const msg = JSON.parse(data);
      if (msg.id !== id) return;
      ws.removeEventListener('message', handler);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

// --- arg parsing ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
    flags[argv[i].slice(2)] = argv[++i];
  } else if (argv[i].startsWith('--')) {
    flags[argv[i].slice(2)] = true;
  }
}
const tabIndex  = flags.tab ? +flags.tab : 0;
const landscape = !!flags.landscape;
const noBg      = !!flags['no-bg'];
const pngOnly   = !!flags['png-only'];

if (flags.help) {
  process.stdout.write('usage: cdp-pdf.mjs [--output <path>] [--tab <n>] [--landscape] [--no-bg] [--png-only]\n');
  process.exit(0);
}

// --- connect ----------------------------------------------------------------------
const port = cdpPort();
let ws, tabUrl;
try {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const pages = tabs.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('no active tabs');
  const tab = pages[tabIndex] || pages[0];
  tabUrl = tab.url || 'unknown';
  ws = await cdpConnect(tab.webSocketDebuggerUrl);
} catch (e) {
  process.stderr.write(`cdp-pdf: cannot connect (Chrome active? tandem-browser status).\n  ${e.message}\n`);
  process.exit(1);
}

// --- filename ---------------------------------------------------------------------
function safeName(url) {
  try {
    const h = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
    return h || 'page';
  } catch { return 'page'; }
}
const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const base = `${ts}-${safeName(tabUrl)}`;

function resolvePath(ext) {
  if (flags.output) return flags.output;
  mkdirSync(outputDir(), { recursive: true });
  return join(outputDir(), `${base}.${ext}`);
}

// --- try PDF ----------------------------------------------------------------------
if (!pngOnly) {
  try {
    const { data } = await cdpCall(ws, 'Page.printToPDF', {
      landscape,
      printBackground: !noBg,
      preferCSSPageSize: true,
    });
    const outPath = resolvePath('pdf');
    writeFileSync(outPath, Buffer.from(data, 'base64'));
    ws.close();
    process.stdout.write(`pdf:${outPath}\n`);
    process.exit(0);
  } catch (e) {
    // headful Chrome does not support printToPDF — fallback to screenshot
    if (!e.message.includes('non-headless') && !e.message.includes('PrintToPDF')) {
      process.stderr.write(`cdp-pdf: Page.printToPDF failed unexpectedly: ${e.message}\n`);
      ws.close();
      process.exit(1);
    }
    process.stderr.write(`cdp-pdf: headful Chrome does not support PDF → full-page screenshot.\n`);
  }
}

// --- fallback: full-page screenshot ----------------------------------------------
try {
  // Real page dimensions (may be taller than the viewport)
  const { contentSize } = await cdpCall(ws, 'Page.getLayoutMetrics');
  const w = Math.ceil(contentSize.width);
  const h = Math.ceil(contentSize.height);

  // Expand viewport to full size so captureBeyondViewport works correctly
  await cdpCall(ws, 'Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
  });

  let data;
  try {
    ({ data } = await cdpCall(ws, 'Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
    }));
  } finally {
    // Restore viewport whether or not captureScreenshot succeeded.
    await cdpCall(ws, 'Emulation.clearDeviceMetricsOverride').catch(() => {});
  }

  const outPath = resolvePath('png');
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  ws.close();
  process.stdout.write(`png:${outPath}\n`);
  process.exit(0);
} catch (e) {
  process.stderr.write(`cdp-pdf: screenshot failed: ${e.message}\n`);
  ws.close();
  process.exit(1);
}
