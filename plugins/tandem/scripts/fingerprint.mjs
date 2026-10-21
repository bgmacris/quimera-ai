#!/usr/bin/env node
// fingerprint.mjs — structural DRIFT detection by route (tandem:map, T015).
//
// Staleness by SIGNAL, not by calendar date: instead of trusting how old the [verified]
// tag is, compare the structural SKELETON of the page (roles/controls/headings) against
// the one you saved. If it changed → the locators for that route in the profile are suspect.
//
// Why the skeleton and not the whole page: we want STRUCTURAL drift, not data drift.
// The agent extracts signals with a canonical browser_evaluate (see skills/map/SKILL.md) that
// normalizes digits to '#' (so "Inbox 112"→"115" does NOT count as drift) and excludes data
// rows. Here we only store/compare the set.
//
// Usage (agent passes the JSON signal array on stdin):
//   echo '<json array of strings>' | fingerprint.mjs capture <host> <route-key>
//   echo '<json array of strings>' | fingerprint.mjs check   <host> <route-key>
//
// capture: saves/updates the route set in sites/<host>.fingerprints.json.
// check:   compares stdin against saved; emits {status, added[], removed[]} on stdout.
//          status = new (no prior) | match (identical) | drift (changed) |
//                   stale (saved with another page-signals algorithm → recapture).

import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { hostOf, normalizeHost } from './host.mjs';
import { dataDir as resolveDataDir } from './paths.mjs';
import { ALGO } from './page-signals.mjs';

const ALGO_SIG = `algo:${ALGO}`;

const dataDir = resolveDataDir();
const sitesDir = join(dataDir, 'sites');

const [, , mode, rawHost, routeKey] = process.argv;
if (!mode || !rawHost || !routeKey || !['capture', 'check'].includes(mode)) {
  process.stderr.write('usage: fingerprint.mjs {capture|check} <host> <route-key>  (JSON signals on stdin)\n');
  process.exit(2);
}

// Normalize and validate the host with the single source (host.mjs): it goes into the store
// path, so without validation this would allow path traversal. normalizeHost throws if not
// a plausible hostname.
let host;
try { host = normalizeHost(rawHost); } catch (e) {
  process.stderr.write(`fingerprint: ${e.message}\n`);
  process.exit(2);
}

function readStdinJson() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { /* empty */ }
  let arr;
  try { arr = JSON.parse(raw); } catch {
    process.stderr.write('fingerprint: stdin is not valid JSON\n');
    process.exit(2);
  }
  if (!Array.isArray(arr)) {
    process.stderr.write('fingerprint: stdin must be an array of strings\n');
    process.exit(2);
  }
  // normalize: strings, unique, sorted (stable)
  return [...new Set(arr.map((s) => String(s)))].sort();
}

const fpPath = join(sitesDir, `${host}.fingerprints.json`);
// check falls back to the legacy port-less store (fingerprints captured before ports were in the key);
// capture always writes the exact key.
const legacyPath = join(sitesDir, `${hostOf(host)}.fingerprints.json`);
function loadStore({ fallback = false } = {}) {
  const p = existsSync(fpPath) ? fpPath : (fallback && legacyPath !== fpPath && existsSync(legacyPath) ? legacyPath : null);
  if (!p) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}
function saveStore(obj) {
  mkdirSync(sitesDir, { recursive: true });
  const tmp = fpPath + '.tmp';
  writeFileSync(tmp, `${JSON.stringify(obj, null, 2)}\n`);
  renameSync(tmp, fpPath);
}

const signals = readStdinJson();
const today = new Date().toISOString().slice(0, 10);

if (mode === 'capture') {
  const store = loadStore();
  store[routeKey] = { captured: today, count: signals.length, signals };
  saveStore(store);
  process.stdout.write(JSON.stringify({ status: 'captured', routeKey, count: signals.length }) + '\n');
  process.exit(0);
}

// mode === 'check'
const store = loadStore({ fallback: true });
const prev = store[routeKey];
if (!prev) {
  process.stdout.write(JSON.stringify({ status: 'new', routeKey, hint: 'no fingerprint saved; use capture' }) + '\n');
  process.exit(0);
}
// A capture made with an older page-signals algorithm can't be compared (every route would "drift").
if (prev.signals.includes(ALGO_SIG) !== signals.includes(ALGO_SIG)) {
  process.stdout.write(JSON.stringify({ status: 'stale', routeKey, captured: prev.captured,
    hint: 'fingerprint captured with another page-signals version; recapture this route (capture)' }) + '\n');
  process.exit(0);
}
const prevSet = new Set(prev.signals);
const nowSet = new Set(signals);
const added = signals.filter((s) => !prevSet.has(s));
const removed = prev.signals.filter((s) => !nowSet.has(s));
const status = added.length === 0 && removed.length === 0 ? 'match' : 'drift';
process.stdout.write(JSON.stringify({
  status, routeKey, captured: prev.captured,
  prevCount: prev.count, nowCount: signals.length,
  added, removed,
}, null, 2) + '\n');
process.exit(status === 'drift' ? 1 : 0);
