#!/usr/bin/env node
// autostart.mjs — PreToolUse on mcp__…tandem__browser_*: make sure there is a browser to talk to.
//
// Real usage: `/tandem:browser-start` was invoked 42 times in 19 sessions by one teammate, and another
// logged 21 "browser down" errors (ECONNREFUSED) plus 71 shell commands diagnosing Chrome by hand.
//   CDP answers                 → silent (one fetch, < 1 s budget).
//   no CDP, autostart on        → start tandem's Chrome now (chrome-daemon.sh start), tell the model.
//   no CDP, autostart off/fails → DENY the call with a clear instruction, instead of a raw ECONNREFUSED.
//
// Also, before anything else:
//   - the site-profile write gate for the MCP's own file writes (guard-sites.mjs decide(): `filename`,
//     run_code) — here, not in a separate hook, to spawn one node process per call instead of two;
//   - OWNERSHIP: CDP answering is not enough. If the listener is another Chrome (a personal one started
//     with remote debugging, with the human's real sessions), deny instead of driving it — the check
//     browser-start already did, which autostart made almost never run. ~30 ms (lsof).
//
// TANDEM_AUTOSTART=1|0 forces it. In external browser mode (TANDEM_BROWSER=external) it is on only when
// TANDEM_BROWSER_START_CMD says how to start that browser. Default: ON, except under WSL — there the
// browser is often the WINDOWS Chrome reached over mirrored networking (certificates, AutoFirma), and
// starting tandem's Linux Chrome on the same port would put the wrong browser in front of the human.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdpPort, dataDir } from './paths.mjs';
import { decide } from './guard-sites.mjs';
import { isMain } from './is-main.mjs';

export function isWsl(env = process.env) {
  if (env.WSL_DISTRO_NAME) return true;
  try { return /microsoft/i.test(readFileSync('/proc/version', 'utf8')); } catch { return false; }
}

export function autostartEnabled(env = process.env) {
  if (env.TANDEM_AUTOSTART === '1') return { on: true };
  if (env.TANDEM_AUTOSTART === '0') return { on: false, why: 'TANDEM_AUTOSTART=0' };
  // External browser: only the user knows how to start it — on if they said how, off otherwise.
  if (env.TANDEM_BROWSER === 'external') {
    return env.TANDEM_BROWSER_START_CMD ? { on: true }
      : { on: false, why: 'external browser mode without TANDEM_BROWSER_START_CMD' };
  }
  if (isWsl(env)) return { on: false, why: 'WSL (the browser may be an external Windows Chrome; set TANDEM_AUTOSTART=1 to let tandem start its own)' };
  return { on: true };
}

// Fast path (~10 ms instead of ~110 ms for bash+lib.sh+lsof): the Chrome tandem started (pidfile) is
// alive AND its command line has our profile and THIS port → it owns the port (two can't listen).
export function ownChromeOnPort(port, dir = dataDir()) {
  if (process.platform === 'win32') return false;
  try {
    const pid = Number(readFileSync(join(dir, 'chrome.pid'), 'utf8'));
    process.kill(pid, 0);
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    return cmd.includes(`--user-data-dir=${join(dir, 'chrome-profile')}`) && cmd.includes(`--remote-debugging-port=${port}`);
  } catch { return false; }
}

async function cdpUp(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}

const isCli = isMain(import.meta.url);
if (isCli) {
  let input = null;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/invalid stdin */ }
  const gate = input && decide(input);
  if (gate) { process.stdout.write(JSON.stringify(gate)); process.exit(0); }

  const port = cdpPort();
  const out = (o) => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...o } })); process.exit(0); };
  const daemon = join(dirname(fileURLToPath(import.meta.url)), 'chrome-daemon.sh');
  if (await cdpUp(port)) {
    // External mode: the browser is foreign BY DESIGN. 'unknown' (process not visible, e.g. Windows
    // Chrome from WSL) is allowed, as browser-start does.
    if (process.env.TANDEM_BROWSER !== 'external' && !ownChromeOnPort(port)) {
      let owner = 'unknown';
      try { owner = execFileSync('bash', [daemon, 'owner'], { encoding: 'utf8', timeout: 5000 }).trim(); } catch { /* unknown */ }
      if (owner === 'foreign') {
        out({ permissionDecision: 'deny', permissionDecisionReason: `tandem: port ${port} answers CDP but it is NOT tandem's Chrome (another browser — maybe a personal Chrome with remote debugging, with the human's real sessions). Not driving it. Ask the human to close it or set TANDEM_CDP_PORT; to drive it on purpose, TANDEM_BROWSER=external.` });
      }
    }
    process.exit(0);
  }

  const mode = autostartEnabled();
  if (mode.on) {
    try {
      // bash explicitly: Windows can't exec a .sh. 40 s stays under the hook's 45 s; a TANDEM_CDP_WAIT
      // beyond that is cut here (Chrome keeps starting, nohup) — the next call then finds it up.
      execFileSync('bash', [daemon, 'start'], { stdio: 'ignore', timeout: 40000 });
    } catch { /* reported below */ }
    if (await cdpUp(port)) {
      out({ additionalContext: `tandem: the shared Chrome was not running; started it (CDP 127.0.0.1:${port}). The human may need to log in again in that window.` });
    }
    out({ permissionDecision: 'deny', permissionDecisionReason: `tandem: Chrome is not running at 127.0.0.1:${port} and starting it failed. Ask the human to run /tandem:browser-start and check its output.` });
  }
  out({ permissionDecision: 'deny', permissionDecisionReason: `tandem: no browser answers at 127.0.0.1:${port}. Ask the human to start it (/tandem:browser-start, or their external browser). Autostart is off: ${mode.why}.` });
}
