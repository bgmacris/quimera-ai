#!/usr/bin/env node
// autostart.mjs — PreToolUse on mcp__…tandem__browser_*: make sure there is a browser to talk to.
//
// Real usage: `/tandem:browser-start` was invoked 42 times in 19 sessions by one teammate, and another
// logged 21 "browser down" errors (ECONNREFUSED) plus 71 shell commands diagnosing Chrome by hand.
//   CDP answers                 → silent (one fetch, < 1 s budget).
//   no CDP, autostart on        → start tandem's Chrome now (chrome-daemon.sh start), tell the model.
//   no CDP, autostart off/fails → DENY the call with a clear instruction, instead of a raw ECONNREFUSED.
//
// TANDEM_AUTOSTART=1|0 forces it. Default: ON, except under WSL — there the browser is often the
// WINDOWS Chrome reached over mirrored networking (certificates, AutoFirma), and starting tandem's
// Linux Chrome on the same port would put the wrong browser (no certificates) in front of the human.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdpPort } from './paths.mjs';

export function isWsl(env = process.env) {
  if (env.WSL_DISTRO_NAME) return true;
  try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch { return false; }
}

export function autostartEnabled(env = process.env) {
  if (env.TANDEM_AUTOSTART === '1') return { on: true };
  if (env.TANDEM_AUTOSTART === '0') return { on: false, why: 'TANDEM_AUTOSTART=0' };
  if (isWsl(env)) return { on: false, why: 'WSL (the browser may be an external Windows Chrome; set TANDEM_AUTOSTART=1 to let tandem start its own)' };
  return { on: true };
}

async function cdpUp(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  try { readFileSync(0, 'utf8'); } catch { /* stdin unused */ }
  const port = cdpPort();
  if (await cdpUp(port)) process.exit(0);

  const out = (o) => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...o } })); process.exit(0); };
  const mode = autostartEnabled();
  if (mode.on) {
    try {
      execFileSync(join(dirname(fileURLToPath(import.meta.url)), 'chrome-daemon.sh'), ['start'], { stdio: 'ignore', timeout: 30000 });
    } catch { /* reported below */ }
    if (await cdpUp(port)) {
      out({ additionalContext: `tandem: the shared Chrome was not running; started it (CDP 127.0.0.1:${port}). The human may need to log in again in that window.` });
    }
    out({ permissionDecision: 'deny', permissionDecisionReason: `tandem: Chrome is not running at 127.0.0.1:${port} and starting it failed. Ask the human to run /tandem:browser-start and check its output.` });
  }
  out({ permissionDecision: 'deny', permissionDecisionReason: `tandem: no browser answers at 127.0.0.1:${port}. Ask the human to start it (/tandem:browser-start, or their external browser). Autostart is off: ${mode.why}.` });
}
