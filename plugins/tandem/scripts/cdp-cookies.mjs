#!/usr/bin/env node
// cdp-cookies.mjs — cookies from tandem's Chrome via direct CDP (no deps, Node 22+).
//
// Storage.getCookies (browser target) exposes the FULL profile jar, including HttpOnly and Secure
// cookies — inaccessible from page JS. Browser-level: needs no open tab (the old per-page
// Network.getAllCookies did). Useful for: security flag analysis, exporting authenticated
// sessions to Burp/curl, replaying requests with real auth context.
//
// Requires active Chrome (tandem-browser start). Node 22+ (native WebSocket + fetch).
//
// Usage: cdp-cookies.mjs [--domain <d>] [--format list|json|curl|headers|netscape] [--reveal]
//   --domain   cookies of that domain AND its subdomains (label boundary: "example.com" matches
//              ".example.com" and "a.example.com", not "notexample.com")
//   --format   list=readable table (default), json=full dump, curl=-H 'Cookie: ...',
//              headers=raw Cookie: line (for Burp repeater), netscape=TXT for curl --cookie-jar
//   --reveal   show VALUES in plaintext. By default the value is REDACTED (a cookie value
//              is usually a session token): list masks it, and formats that exist to dump
//              the full value (json/curl/headers/netscape) require explicit --reveal.

import { browserWsUrl, connect } from './cdp.mjs';
import { domainMatches } from './cookie-match.mjs';

// Piped into `grep -q`/`head`: a closed stdout is the reader saying "enough", not an error.
process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); throw e; });


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

// --- connect to the browser target and read the whole jar --------------------------
let cdp; let cookies;
try {
  cdp = await connect(await browserWsUrl());
  ({ cookies } = await cdp.call('Storage.getCookies'));
} catch (e) {
  process.stderr.write(`cdp-cookies: cannot read cookies (Chrome active? tandem-browser status).\n  ${e.message}\n`);
  cdp?.close();
  process.exit(1);
}
cdp.close();

if (domainFilter) cookies = cookies.filter((c) => domainMatches(c.domain, domainFilter));
// A Cookie header is per request/host: merging several sites into one is almost never what you want.
const domains = new Set(cookies.map((c) => c.domain.replace(/^\./, '')));
if (['curl', 'headers'].includes(format) && domains.size > 1) {
  process.stderr.write(`cdp-cookies: warning — ${domains.size} domains merged into one Cookie header; narrow with --domain.\n`);
}
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
