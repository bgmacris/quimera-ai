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
// Deliberate decision: PORT is discarded (a "site" is indexed by hostname, not host:port).
// Previously behavior diverged — recipe/map kept it, fingerprint broke on ':', hook discarded
// it via new URL() — unified to discard (and ':' would break the filename on macOS).
// Accepts a full URL (with scheme) or a bare host. IDN: a URL with non-ASCII host is
// normalized to punycode (new URL); a bare non-ASCII host is rejected (pass the URL instead).
// IPv6 literals NOT supported as keys (':' / '[]' cannot appear in filenames) → rejected.
//
// Module usage:  import { normalizeHost } from './host.mjs'
// CLI (map.sh):  host.mjs <url-or-host>  → prints the host, or exit 2 + error on stderr.

export function normalizeHost(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('empty host');
  let host = raw.trim();
  if (/:\/\//.test(host)) {
    // With scheme → full URL. new URL().hostname is already clean (no scheme/port/path/
    // userinfo) and lowercase; don't apply manual stripping or you'd break valid cases.
    try { host = new URL(host).hostname; } catch { /* malformed → falls to validation, which rejects it */ }
  } else {
    // Bare host: may carry userinfo@ and/or :port. Cut at the first ':' or '/'.
    host = host.replace(/^[^@]*@/, '').replace(/[:/].*$/, '');
  }
  host = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    throw new Error(`invalid host after normalizing: '${host}'`);
  }
  return host;
}

// --- CLI ----------------------------------------------------------------------------
import { fileURLToPath } from 'node:url';
const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  try {
    process.stdout.write(normalizeHost(process.argv[2] ?? '') + '\n');
    process.exit(0);
  } catch (e) {
    process.stderr.write('host: ' + e.message + '\n');
    process.exit(2);
  }
}
