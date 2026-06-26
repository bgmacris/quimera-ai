#!/usr/bin/env node
// cdp-pdf.mjs — genera PDF o screenshot full-page del tab activo via CDP (sin deps, Node 22+).
//
// Intenta Page.printToPDF (solo funciona si Chrome arrancó con --headless). Si falla,
// fallback automático a Page.captureScreenshot full-page (funciona siempre en tandem).
// El archivo generado y su formato se imprimen en stdout para que el agente los use.
//
// Uso: cdp-pdf.mjs [--output <ruta>] [--tab <n>] [--landscape] [--no-bg] [--png-only]
//   --output <ruta>   ruta de salida explícita (.pdf o .png según lo que se genere)
//   --tab <n>         índice del tab a capturar (default 0)
//   --landscape       orientación apaisada (solo PDF)
//   --no-bg           sin colores de fondo (solo PDF)
//   --png-only        salta el intento PDF, va directo a screenshot

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

// --- cliente CDP ------------------------------------------------------------------
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

// --- conectar ---------------------------------------------------------------------
const port = cdpPort();
let ws, tabUrl;
try {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const pages = tabs.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('no hay tabs activos');
  const tab = pages[tabIndex] || pages[0];
  tabUrl = tab.url || 'unknown';
  ws = await cdpConnect(tab.webSocketDebuggerUrl);
} catch (e) {
  process.stderr.write(`cdp-pdf: no puedo conectar (¿Chrome activo? tandem-browser status).\n  ${e.message}\n`);
  process.exit(1);
}

// --- nombre de fichero ------------------------------------------------------------
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

// --- intentar PDF -----------------------------------------------------------------
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
    // headful Chrome no soporta printToPDF — fallback a screenshot
    if (!e.message.includes('non-headless') && !e.message.includes('PrintToPDF')) {
      process.stderr.write(`cdp-pdf: Page.printToPDF falló inesperadamente: ${e.message}\n`);
      ws.close();
      process.exit(1);
    }
    process.stderr.write(`cdp-pdf: Chrome headful no soporta PDF → screenshot full-page.\n`);
  }
}

// --- fallback: screenshot full-page ----------------------------------------------
try {
  // Dimensiones reales de la página (puede ser más alta que el viewport)
  const { contentSize } = await cdpCall(ws, 'Page.getLayoutMetrics');
  const w = Math.ceil(contentSize.width);
  const h = Math.ceil(contentSize.height);

  // Expande el viewport al tamaño completo para que captureBeyondViewport funcione bien
  await cdpCall(ws, 'Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
  });

  const { data } = await cdpCall(ws, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: w, height: h, scale: 1 },
  });

  // Restaura viewport
  await cdpCall(ws, 'Emulation.clearDeviceMetricsOverride');

  const outPath = resolvePath('png');
  writeFileSync(outPath, Buffer.from(data, 'base64'));
  ws.close();
  process.stdout.write(`png:${outPath}\n`);
  process.exit(0);
} catch (e) {
  process.stderr.write(`cdp-pdf: screenshot falló: ${e.message}\n`);
  ws.close();
  process.exit(1);
}
