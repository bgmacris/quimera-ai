#!/usr/bin/env node
// cdp-record.mjs — record ALL tabs of tandem's Chrome to a HAR file (no deps, Node 22+).
//
// Capture engine: capture.mjs (browser-level auto-attach, redirect hops, ExtraInfo headers).
// Ends on SIGTERM/SIGINT or --duration, then writes the HAR (0600). Built for network-trace
// evaluation (e.g. WebArena-Verified's NetworkEventEvaluator) — see har.mjs for the shape.
//
// Usage: cdp-record.mjs --out <file.har> [--duration <s>] [--reveal] [--extra-header "Name: value"]
//   --reveal         keep credential headers/cookie values (default: redacted)
//   --extra-header   add a request header on every attached page (e.g. a test env's auto-login)
// Prints "recording" on stderr once attached (a runner can wait for it).

import { writeFileSync } from 'node:fs';
import { browserWsUrl, connect } from './cdp.mjs';
import { startCapture } from './capture.mjs';
import { BODY_CAP, toHar, toHarEntry, wantsBody } from './har.mjs';

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2);
  if (argv[i + 1] && !argv[i + 1].startsWith('--')) flags[k] = argv[++i]; else flags[k] = true;
}
if (!flags.out || flags.out === true) {
  process.stderr.write('usage: cdp-record.mjs --out <file.har> [--duration <s>] [--reveal] [--extra-header "Name: value"]\n');
  process.exit(2);
}
const reveal = !!flags.reveal;
const extra = typeof flags['extra-header'] === 'string' ? flags['extra-header'].split(/:\s*/) : null;

let cdp;
try { cdp = await connect(await browserWsUrl()); } catch (e) {
  process.stderr.write(`cdp-record: cannot connect (Chrome active? tandem-browser status).\n  ${e.message}\n`);
  process.exit(1);
}

const entries = [];
const cap = await startCapture(cdp, {
  onEntry: (raw) => entries.push(toHarEntry(raw, { reveal })),
  wantsBody, bodyCap: BODY_CAP,
  extraHeader: extra ? [extra[0], extra.slice(1).join(':')] : null,
});
process.stderr.write('cdp-record: recording\n');

let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await cap.stop();
  writeFileSync(flags.out, JSON.stringify(toHar(entries), null, 1) + '\n', { mode: 0o600 });
  process.stderr.write(`cdp-record: ${entries.length} entries → ${flags.out}\n`);
  cdp.close(); process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
cdp.onClose(() => stop());
if (flags.duration) setTimeout(stop, +flags.duration * 1000);
