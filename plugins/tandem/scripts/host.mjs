#!/usr/bin/env node
// host.mjs — single source for "URL or host" → canonical store hostname (tandem:map).
//
// The host goes into the store path (sites/<host>.md, sites/<host>.fingerprints.json), so
// a value with '/', '..' or garbage would allow reading/writing OUTSIDE sites/ (path traversal).
// Previously this logic lived duplicated (and divergent) in recipe.mjs, fingerprint.mjs,
// hook-inject-profile.mjs and map.sh: only one validated the charset, another broke on
// uppercase schemes. Here, a single definition that normalizes AND validates. Throws if the
// result is not a plausible hostname.
//
// PORT (decision revised 2026-10-21, from real usage): a NON-DEFAULT port is part of the key, as
// `<host>_<port>` — `localhost:5184` → `localhost_5184`. Discarding it merged 9 different local apps
// (ports 5173, 5181-86, 5192, 5197) into one 27 KB `localhost` profile. Default ports (80/443, or none)
// stay out of the key. `_` is the separator because ':' is not a legal filename character on Windows
// (tandem runs there) and `_` never occurs in a valid hostname, so the key is unambiguous.
// Readers fall back from `host_port` to the legacy host-only profile (hostOf), so old profiles keep working.
// Accepts a full URL (with scheme), a bare host, or a key (`host_port`). IDN: a URL with non-ASCII host is
// normalized to punycode (new URL); a bare non-ASCII host is rejected (pass the URL instead).
// IPv6 literals NOT supported as keys (':' / '[]' cannot appear in filenames) → rejected.
//
// Module usage:  import { normalizeHost } from './host.mjs'
// CLI (map.sh):  host.mjs <url-or-host>  → prints the host, or exit 2 + error on stderr.

export function normalizeHost(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('empty host');
  let host = raw.trim();
  let port = '';
  if (/:\/\//.test(host)) {
    // With scheme → full URL. new URL() gives a clean lowercase hostname and an EMPTY port when it is
    // the scheme's default (https://x:443 → ''), so default ports never reach the key.
    try { const u = new URL(host); host = u.hostname; port = u.port; } catch { /* malformed → validation rejects it */ }
  } else {
    // Bare host or key: may carry userinfo@, :port or _port. Without a scheme, 80/443 count as default.
    host = host.replace(/^[^@]*@/, '').replace(/\/.*$/, '');
    const m = host.match(/^(.*?)[:_](\d+)$/);
    if (m) { host = m[1]; port = m[2]; }
    else host = host.replace(/:.*$/, '');
    if (port === '80' || port === '443') port = '';
  }
  host = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    throw new Error(`invalid host after normalizing: '${host}'`);
  }
  if (port && !(+port >= 1 && +port <= 65535)) throw new Error(`invalid port: '${port}'`);
  return port ? `${host}_${+port}` : host;
}

// Host part of a key (`localhost_5184` → `localhost`): the legacy, port-less profile to fall back to.
export function hostOf(key) {
  return String(key).replace(/_\d+$/, '');
}

// --- CLI ----------------------------------------------------------------------------
import { isMain } from './is-main.mjs';
const isCli = isMain(import.meta.url);
if (isCli) {
  try {
    process.stdout.write(normalizeHost(process.argv[2] ?? '') + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write('host: ' + e.message + '\n');
    process.exit(2);
  }
}
