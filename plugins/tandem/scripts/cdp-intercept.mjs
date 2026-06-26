#!/usr/bin/env node
// cdp-intercept.mjs — sniffer HTTP del Chrome de tandem via CDP (sin deps, Node 22+).
//
// Captura request+response (con bodies completos) del tab activo: APIs privadas, request
// bodies (credenciales, CSRF tokens), response bodies de endpoints autenticados.
//
// ⚠ El log puede contener credenciales y tokens. Trátalo como dato sensible.
//   Borra con `cdp-intercept.mjs clear` al terminar.
//   Log: ~/.claude/tandem/intercept.ndjson
//
// Uso:
//   cdp-intercept.mjs start [--duration <s>] [--tab <n>]         captura (foreground, Ctrl-C para salir)
//   cdp-intercept.mjs show  [--url <p>] [--method <m>]           filtra y muestra
//                           [--status <code|2xx|4xx|5xx>]
//                           [--mime <tipo>] [--limit <n>] [--body]
//   cdp-intercept.mjs clear                                       borra el log
//   cdp-intercept.mjs count                                       nº de entries

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, appendFileSync, existsSync, unlinkSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

// --- config -----------------------------------------------------------------------
function cdpPort() {
  const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
  try { return +readFileSync(join(dataDir, 'cdp-port'), 'utf8').trim() || 9222; }
  catch { return +(process.env.TANDEM_CDP_PORT || 9222); }
}
function logPath() {
  const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
  return join(dataDir, 'intercept.ndjson');
}

// --- cliente CDP (WebSocket + fetch nativos Node 22+) ----------------------------
function cdpConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', (e) => reject(new Error(String(e.message || e))));
  });
}

let _id = 0;
const _callbacks = new Map();
const _eventHandlers = new Map();

function cdpCall(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++_id;
    _callbacks.set(id, (msg) => msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function onCdpEvent(method, handler) { _eventHandlers.set(method, handler); }
function handleMessage({ data }) {
  const msg = JSON.parse(data);
  if (msg.id !== undefined) {
    const cb = _callbacks.get(msg.id);
    if (cb) { _callbacks.delete(msg.id); cb(msg); }
  } else if (msg.method) {
    _eventHandlers.get(msg.method)?.(msg.params);
  }
}

// --- arg parsing ------------------------------------------------------------------
const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--') && argv[i + 1] && !argv[i + 1].startsWith('--')) {
    flags[argv[i].slice(2)] = argv[++i];
  } else if (argv[i].startsWith('--')) {
    flags[argv[i].slice(2)] = true;
  }
}

if (!['start', 'show', 'clear', 'count'].includes(cmd)) {
  process.stderr.write('uso: cdp-intercept.mjs {start [--duration <s>] [--tab <n>] | show [...] | clear | count}\n');
  process.exit(2);
}

// ==================================================================================
// MODO: clear / count
// ==================================================================================
if (cmd === 'clear') {
  const p = logPath();
  if (existsSync(p)) { unlinkSync(p); process.stdout.write('cdp-intercept: log borrado.\n'); }
  else { process.stdout.write('cdp-intercept: no hay log.\n'); }
  process.exit(0);
}

if (cmd === 'count') {
  const p = logPath();
  if (!existsSync(p)) { process.stdout.write('0\n'); process.exit(0); }
  let n = 0;
  const rl = createInterface({ input: createReadStream(p), crlfDelay: Infinity });
  rl.on('line', (l) => { if (l.trim()) n++; });
  rl.on('close', () => { process.stdout.write(`${n}\n`); });
  rl.on('error', () => process.exit(1));
  process.exit(0);  // readline close fires async
}

// ==================================================================================
// MODO: show
// ==================================================================================
if (cmd === 'show') {
  const p = logPath();
  if (!existsSync(p)) { process.stderr.write('cdp-intercept: no hay log. Usa `start` primero.\n'); process.exit(0); }

  const urlPat   = (flags.url    || '').toLowerCase();
  const methPat  = (flags.method || '').toUpperCase();
  const statusPat = flags.status || '';
  const mimePat  = (flags.mime   || '').toLowerCase();
  const limit    = flags.limit ? +flags.limit : Infinity;
  const showBody = !!flags.body;

  function matchStatus(s) {
    if (!statusPat) return true;
    if (statusPat.endsWith('xx')) return Math.floor(s / 100) === +statusPat[0];
    return s === +statusPat;
  }

  const entries = [];
  const rl = createInterface({ input: createReadStream(p), crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let e;
    try { e = JSON.parse(line); } catch { return; }
    if (urlPat   && !e.url.toLowerCase().includes(urlPat)) return;
    if (methPat  && e.method !== methPat) return;
    if (statusPat && !matchStatus(e.status)) return;
    if (mimePat  && !(e.mimeType || '').toLowerCase().includes(mimePat)) return;
    entries.push(e);
  });
  rl.on('close', () => {
    const shown = entries.slice(-Math.min(entries.length, limit));
    if (!shown.length) { process.stdout.write('(sin resultados)\n'); return; }
    for (const e of shown) {
      const ts   = e.ts ? e.ts.replace('T', ' ').slice(0, 19) : '?';
      const stat = String(e.status ?? '?').padStart(3);
      const meth = (e.method || '?').padEnd(6);
      const mime = (e.mimeType || '').split(';')[0].padEnd(22);
      process.stdout.write(`${ts}  ${meth}  ${stat}  ${mime}  ${e.url}\n`);
      if (showBody) {
        if (e.postData) process.stdout.write(`  ► req  ${e.postData.slice(0, 1024)}\n`);
        if (e.body != null) {
          const preview = typeof e.body === 'string' ? e.body.slice(0, 1024) : e.body;
          process.stdout.write(`  ◄ resp ${preview}\n`);
        }
      }
    }
    process.stdout.write(`\n${shown.length} de ${entries.length} entries\n`);
  });
  rl.on('error', () => process.exit(1));
}

// ==================================================================================
// MODO: start
// ==================================================================================
if (cmd === 'start') {
  const duration = flags.duration ? +flags.duration * 1000 : null;
  const tabIndex = flags.tab ? +flags.tab : 0;
  const BODY_CAP = 32 * 1024; // 32KB por body en el log

  const port = cdpPort();
  let ws;
  try {
    const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    const pages = tabs.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!pages.length) throw new Error('no hay tabs activos');
    const tab = pages[tabIndex] || pages[0];
    process.stderr.write(`cdp-intercept: capturando tab [${tabIndex}] ${tab.url || '?'}\n`);
    ws = await cdpConnect(tab.webSocketDebuggerUrl);
  } catch (e) {
    process.stderr.write(`cdp-intercept: no puedo conectar (¿Chrome activo? tandem-browser status).\n  ${e.message}\n`);
    process.exit(1);
  }

  ws.addEventListener('message', handleMessage);
  ws.addEventListener('close', () => {
    process.stderr.write('\ncdp-intercept: Chrome cerró la conexión.\n');
    report();
    process.exit(0);
  });

  // Habilitar Network domain
  await cdpCall(ws, 'Network.enable', { maxPostDataSize: 65536 });
  process.stderr.write(`cdp-intercept: capturando${duration ? ` (${duration / 1000}s)` : ' — Ctrl-C para salir'}… log → ${logPath()}\n`);

  // Correlación requestId → metadata en vuelo
  const pending = new Map();
  let captured = 0;

  function writeEntry(entry) {
    try {
      appendFileSync(logPath(), JSON.stringify(entry) + '\n', 'utf8');
      captured++;
    } catch {}
  }

  onCdpEvent('Network.requestWillBeSent', ({ requestId, request, redirectResponse }) => {
    // Redirect: actualiza solo la URL del entry existente
    if (redirectResponse && pending.has(requestId)) {
      pending.get(requestId).url = request.url;
      return;
    }
    // Limita el tamaño del Map (requests que nunca terminan: WebSocket, SSE)
    if (pending.size > 500) {
      const stale = pending.keys().next().value;
      pending.delete(stale);
    }
    pending.set(requestId, {
      requestId,
      ts: new Date().toISOString(),
      method: request.method,
      url: request.url,
      postData: request.postData || null,
      requestHeaders: request.headers,
      status: null, mimeType: null, responseHeaders: null, body: null,
    });
  });

  onCdpEvent('Network.responseReceived', ({ requestId, response }) => {
    const e = pending.get(requestId);
    if (!e) return;
    e.status = response.status;
    e.mimeType = response.mimeType;
    e.responseHeaders = response.headers;
  });

  onCdpEvent('Network.loadingFinished', ({ requestId }) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);

    const getBody = cdpCall(ws, 'Network.getResponseBody', { requestId })
      .catch(() => ({ body: null, base64Encoded: false }));

    // getRequestPostData da el body completo incluso para requests grandes
    const getPost = (entry.method !== 'GET' && entry.method !== 'HEAD')
      ? cdpCall(ws, 'Network.getRequestPostData', { requestId }).catch(() => null)
      : Promise.resolve(null);

    Promise.all([getBody, getPost]).then(([{ body, base64Encoded }, postResult]) => {
      if (base64Encoded && body) {
        const bytes = Math.floor(body.length * 3 / 4);
        entry.body = `[binary: ${bytes} bytes]`;
      } else if (body) {
        entry.body = body.length > BODY_CAP ? body.slice(0, BODY_CAP) + `…[+${body.length - BODY_CAP}b]` : body;
      }
      if (postResult?.postData) entry.postData = postResult.postData;
      writeEntry(entry);
    });
  });

  onCdpEvent('Network.loadingFailed', ({ requestId }) => pending.delete(requestId));

  function report() {
    process.stderr.write(`cdp-intercept: ${captured} request(s) capturadas → ${logPath()}\n`);
  }

  process.on('SIGINT', () => { report(); ws.close(); process.exit(0); });
  if (duration) setTimeout(() => { report(); ws.close(); process.exit(0); }, duration);
}
