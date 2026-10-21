#!/usr/bin/env node
// cdp-intercept.mjs — HTTP sniffer for tandem's Chrome via CDP, ALL tabs (no deps, Node 22+).
//
// Captures request+response (with bodies) across every tab: private APIs, request bodies, CSRF
// tokens, authenticated responses. Engine: capture.mjs (browser-level auto-attach, redirect hops).
// `start` runs the capture as a DAEMON and returns at once — a foreground capture used to block the
// slash command (and Claude) until Ctrl-C. `stop` ends it.
//
// ⚠ The log may contain credentials. Credential headers (Authorization, Cookie, Set-Cookie, CSRF…)
//   are redacted unless `start --reveal`; bodies are kept (that is the point). Log is 0600.
//   Log: <data-dir>/intercept.ndjson — `clear` when done.
//
// Usage:
//   cdp-intercept.mjs start [--duration <s>] [--reveal]   capture in the background (all tabs)
//   cdp-intercept.mjs stop                                 end the capture
//   cdp-intercept.mjs status                               running? + entries
//   cdp-intercept.mjs show  [--url <p>] [--method <m>] [--status <code|2xx|4xx|5xx>]
//                           [--mime <type>] [--limit <n>] [--body]
//   cdp-intercept.mjs clear | count

import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, createReadStream, existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { browserWsUrl, connect } from './cdp.mjs';
import { startCapture } from './capture.mjs';
import { dataDir, ensureDataDir } from './paths.mjs';
import { redactHeaders } from './redact.mjs';

// Piped into `grep -q`/`head`: a closed stdout is the reader saying "enough", not an error.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });

const logPath = () => join(dataDir(), 'intercept.ndjson');
const pidPath = () => join(dataDir(), 'intercept.pid');
const readyPath = () => join(dataDir(), 'intercept.ready');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true;
}

function runningPid() {
  try {
    const pid = +readFileSync(pidPath(), 'utf8');
    process.kill(pid, 0);
    // A stale pidfile (reboot, SIGKILL) may name a recycled PID: it must be OUR daemon, or we'd
    // SIGTERM someone else's process on `stop` and claim "already capturing" forever on `start`.
    if (process.platform !== 'win32' && !/cdp-intercept\.mjs\s+__run/.test(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }))) return null;
    return pid;
  } catch { return null; }
}
function countLines() {
  if (!existsSync(logPath())) return 0;
  return readFileSync(logPath(), 'utf8').split('\n').filter((l) => l.trim()).length;
}

// Pentest wants the text bodies of documents/XHR, not assets.
const wantsBody = (e) => !['Image', 'Stylesheet', 'Script', 'Font', 'Media'].includes(e.type);

function toLine(raw, reveal) {
  const reqH = raw.extraReqHeaders || raw.reqHeaders;
  const resH = raw.extraResHeaders || raw.resHeaders;
  return {
    ts: raw.started, method: raw.method, url: raw.url, status: raw.status || null, mimeType: raw.mimeType || null,
    redirectURL: raw.redirectURL || null, postData: raw.postData ?? null, body: raw.body ?? null,
    requestHeaders: reveal ? reqH : redactHeaders(reqH), responseHeaders: reveal ? resH : redactHeaders(resH),
  };
}

const USAGE = 'usage: cdp-intercept.mjs {start [--duration <s>] [--reveal] | stop | status | show [...] | clear | count}\n';
if (!['start', 'stop', 'status', 'show', 'clear', 'count', '__run'].includes(cmd)) { process.stderr.write(USAGE); process.exit(2); }

// --- daemon body ---------------------------------------------------------------------
if (cmd === '__run') {
  const reveal = !!flags.reveal;
  let cdp;
  try { cdp = await connect(await browserWsUrl()); } catch (e) {
    process.stderr.write(`cdp-intercept: cannot connect: ${e.message}\n`); process.exit(1);
  }
  ensureDataDir();
  const cap = await startCapture(cdp, {
    onEntry: (raw) => { try { appendFileSync(logPath(), JSON.stringify(toLine(raw, reveal)) + '\n', { encoding: 'utf8', mode: 0o600 }); } catch {} },
    wantsBody, bodyCap: 32 * 1024,
  });
  writeFileSync(readyPath(), String(process.pid));
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    await cap.stop(); cdp.close();
    rmSync(pidPath(), { force: true }); rmSync(readyPath(), { force: true });
    process.exit(0);
  };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  cdp.onClose(stop);
  if (flags.duration) setTimeout(stop, +flags.duration * 1000);
}

// --- start / stop / status -----------------------------------------------------------
if (cmd === 'start') {
  if (runningPid()) { process.stdout.write(`cdp-intercept: already capturing (pid ${runningPid()}). Use stop first.\n`); process.exit(0); }
  ensureDataDir();
  rmSync(readyPath(), { force: true });
  const args = [fileURLToPath(import.meta.url), '__run'];
  if (flags.duration) args.push('--duration', String(flags.duration));
  if (flags.reveal) args.push('--reveal');
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  writeFileSync(pidPath(), String(child.pid), { mode: 0o600 });
  child.unref();
  for (let i = 0; i < 40 && !existsSync(readyPath()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!existsSync(readyPath())) {
    process.stderr.write('cdp-intercept: capture did not start (Chrome active? tandem-browser status).\n');
    try { process.kill(child.pid); } catch {}
    rmSync(pidPath(), { force: true });
    process.exit(1);
  }
  process.stdout.write(`cdp-intercept: capturing ALL tabs in the background (pid ${child.pid})${flags.duration ? `, ${flags.duration}s` : ''}`
    + `${flags.reveal ? ', credential headers IN CLEAR' : ', credential headers redacted'} → ${logPath()}\n`
    + 'Stop with: tandem-intercept stop\n');
  process.exit(0);
}
if (cmd === 'stop') {
  const pid = runningPid();
  if (!pid) { process.stdout.write('cdp-intercept: no capture running.\n'); process.exit(0); }
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 40; i++) { try { process.kill(pid, 0); } catch { break; } await new Promise((r) => setTimeout(r, 125)); }
  rmSync(pidPath(), { force: true });
  process.stdout.write(`cdp-intercept: stopped. ${countLines()} entries in ${logPath()}\n`);
  process.exit(0);
}
if (cmd === 'status') {
  const pid = runningPid();
  process.stdout.write(`cdp-intercept: ${pid ? `capturing (pid ${pid})` : 'not running'} · ${countLines()} entries · ${logPath()}\n`);
  process.exit(0);
}

// --- clear / count --------------------------------------------------------------------
if (cmd === 'clear') {
  if (existsSync(logPath())) { unlinkSync(logPath()); process.stdout.write('cdp-intercept: log cleared.\n'); }
  else process.stdout.write('cdp-intercept: no log found.\n');
  process.exit(0);
}
if (cmd === 'count') { process.stdout.write(`${countLines()}\n`); process.exit(0); }

// --- show -----------------------------------------------------------------------------
if (cmd === 'show') {
  if (!existsSync(logPath())) { process.stderr.write('cdp-intercept: no log. Use `start` first.\n'); process.exit(0); }
  const urlPat = (flags.url || '').toLowerCase();
  const methPat = (flags.method || '').toUpperCase();
  const statusPat = flags.status || '';
  const mimePat = (flags.mime || '').toLowerCase();
  const limit = flags.limit ? +flags.limit : Infinity;
  const showBody = !!flags.body;
  const matchStatus = (s) => (!statusPat ? true : statusPat.endsWith('xx') ? Math.floor(s / 100) === +statusPat[0] : s === +statusPat);

  const entries = [];
  const rl = createInterface({ input: createReadStream(logPath()), crlfDelay: Infinity });
  rl.on('line', (line) => {
    let e; try { e = JSON.parse(line); } catch { return; }
    if (urlPat && !e.url.toLowerCase().includes(urlPat)) return;
    if (methPat && e.method !== methPat) return;
    if (statusPat && !matchStatus(e.status)) return;
    if (mimePat && !(e.mimeType || '').toLowerCase().includes(mimePat)) return;
    entries.push(e);
  });
  rl.on('close', () => {
    const shown = entries.slice(-Math.min(entries.length, limit));
    if (!shown.length) { process.stdout.write('(no results)\n'); return; }
    for (const e of shown) {
      const ts = e.ts ? e.ts.replace('T', ' ').slice(0, 19) : '?';
      process.stdout.write(`${ts}  ${(e.method || '?').padEnd(6)}  ${String(e.status ?? '?').padStart(3)}  ${(e.mimeType || '').split(';')[0].padEnd(22)}  ${e.url}${e.redirectURL ? `  → ${e.redirectURL}` : ''}\n`);
      if (showBody) {
        if (e.postData) process.stdout.write(`  ► req  ${e.postData.slice(0, 1024)}\n`);
        if (e.body != null) process.stdout.write(`  ◄ resp ${String(e.body).slice(0, 1024)}\n`);
      }
    }
    process.stdout.write(`\n${shown.length} of ${entries.length} entries\n`);
  });
}
