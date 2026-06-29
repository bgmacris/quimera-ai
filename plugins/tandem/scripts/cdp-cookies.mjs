#!/usr/bin/env node
// cdp-cookies.mjs — cookies from tandem's Chrome via direct CDP (no deps, Node 22+).
//
// Network.getAllCookies exposes the FULL profile jar, including HttpOnly and Secure cookies —
// inaccessible from page JS. Useful for: security flag analysis, exporting authenticated
// sessions to Burp/curl, replaying requests with real auth context.
//
// Requires active Chrome (tandem-browser start). Node 22+ (native WebSocket + fetch).
//
// Usage: cdp-cookies.mjs [--domain <d>] [--format list|json|curl|headers|netscape] [--reveal]
//   --domain   filter by domain substring (case-insensitive)
//   --format   list=readable table (default), json=full dump, curl=-H 'Cookie: ...',
//              headers=raw Cookie: line (for Burp repeater), netscape=TXT for curl --cookie-jar
//   --reveal   show VALUES in plaintext. By default the value is REDACTED (a cookie value
//              is usually a session token): list masks it, and formats that exist to dump
//              the full value (json/curl/headers/netscape) require explicit --reveal.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

// --- config (same logic as lib.sh for path consistency) ---------------------------
function cdpPort() {
  const dataDir = process.env.TANDEM_DATA_DIR || join(homedir(), '.claude', 'tandem');
  try { return +readFileSync(join(dataDir, 'cdp-port'), 'utf8').trim() || 9222; }
  catch { return +(process.env.TANDEM_CDP_PORT || 9222); }
}

// --- minimal CDP client (native Node 22+ WebSocket) --------------------------------
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
const format = flags.format || 'list';
const domainFilter = (flags.domain || '').toLowerCase();
const reveal = !!flags.reveal;

if (!['list', 'json', 'curl', 'headers', 'netscape'].includes(format)) {
  process.stderr.write(`cdp-cookies: unknown format '${format}'. Valid: list json curl headers netscape\n`);
  process.exit(2);
}
if (!reveal && ['json', 'curl', 'headers', 'netscape'].includes(format)) {
  process.stderr.write(`cdp-cookies: format '${format}' dumps values in plaintext. Add --reveal if that is your intent.\n`);
  process.exit(2);
}

// --- connect to page target (Network.getAllCookies requires page, not Browser target) --
const port = cdpPort();
let ws;
try {
  const tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
  const tab = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!tab) throw new Error('no active tabs');
  ws = await cdpConnect(tab.webSocketDebuggerUrl);
} catch (e) {
  process.stderr.write(`cdp-cookies: cannot connect (Chrome active? tandem-browser status).\n  ${e.message}\n`);
  process.exit(1);
}

// --- get cookies ------------------------------------------------------------------
let cookies;
try {
  ({ cookies } = await cdpCall(ws, 'Network.getAllCookies'));
} catch (e) {
  process.stderr.write(`cdp-cookies: Network.getAllCookies failed: ${e.message}\n`);
  ws.close();
  process.exit(1);
}
ws.close();

if (domainFilter) cookies = cookies.filter((c) => c.domain.toLowerCase().includes(domainFilter));
if (!cookies.length) {
  process.stderr.write(`cdp-cookies: no cookies${domainFilter ? ` for '${domainFilter}'` : ''}.\n`);
  process.exit(0);
}
cookies.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name));

// --- output -----------------------------------------------------------------------
switch (format) {
  case 'list': {
    const D = 28, N = 24, V = 30;
    const hdr = `${'domain'.padEnd(D)}  ${'name'.padEnd(N)}  ${'value'.padEnd(V)}  flags`;
    process.stdout.write(`${hdr}\n${'-'.repeat(hdr.length + 8)}\n`);
    for (const c of cookies) {
      const fgs = [c.httpOnly && 'HttpOnly', c.secure && 'Secure',
        c.sameSite && `SameSite=${c.sameSite}`, c.session && 'Session'].filter(Boolean).join(' ');
      let val;
      if (!reveal) {
        const v = c.value;
        val = v.length <= 8 ? '•'.repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-4)}`;
      } else {
        val = c.value.length > V ? c.value.slice(0, V - 1) + '…' : c.value;
      }
      process.stdout.write(
        `${c.domain.slice(0, D).padEnd(D)}  ${c.name.slice(0, N).padEnd(N)}  ${val.padEnd(V)}  ${fgs}\n`,
      );
    }
    if (!reveal) process.stdout.write('(values redacted; use --reveal to see them in plaintext)\n');
    process.stdout.write(`\n${cookies.length} cookie(s)\n`);
    break;
  }
  case 'json':
    process.stdout.write(JSON.stringify(cookies, null, 2) + '\n');
    break;
  case 'curl': {
    const pairs = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    process.stdout.write(`-H 'Cookie: ${pairs}'\n`);
    break;
  }
  case 'headers': {
    const pairs = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    process.stdout.write(`Cookie: ${pairs}\n`);
    break;
  }
  case 'netscape': {
    process.stdout.write('# Netscape HTTP Cookie File\n');
    for (const c of cookies) {
      const dom = c.domain.startsWith('.') ? c.domain : `.${c.domain}`;
      const exp = c.expires && c.expires > 0 ? Math.floor(c.expires) : 0;
      process.stdout.write(`${dom}\tTRUE\t${c.path || '/'}\t${c.secure ? 'TRUE' : 'FALSE'}\t${exp}\t${c.name}\t${c.value}\n`);
    }
    break;
  }
}
