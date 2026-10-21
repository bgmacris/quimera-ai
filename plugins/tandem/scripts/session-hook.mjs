#!/usr/bin/env node
// session-hook.mjs — shared Chrome lifecycle across Claude Code sessions (leases).
//
// One Chrome, many sessions: every Claude session on this machine talks to the same CDP port.
// The old SessionEnd hook stopped Chrome unconditionally, so closing ANY session pulled the
// browser from under the others. Now each session that uses a browser_* tool holds a lease,
// and Chrome is stopped only when the last live lease goes away.
//
//   touch    PostToolUse on mcp__…tandem__browser_*  → (re)write leases/<session>
//   end      SessionEnd   → drop own lease + injection markers; stop Chrome if no live lease left
//   compact  SessionStart (matcher: compact) → drop injection markers, so the profile that the
//            compaction just summarized away is injected again on the next navigate
//
// A lease is live if touched within LEASE_TTL_MS. A crashed session (no SessionEnd) leaves a
// lease that keeps Chrome up until it expires — the safe side of the trade-off.
// Reads the hook JSON on stdin; never prints to stdout (hooks stay silent).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir, ensureDataDir } from './paths.mjs';
import { cleanupSessionMarkers, extractSessionId, sessionKey } from './map-inject-core.mjs';
import { isMain } from './is-main.mjs';

export const LEASE_TTL_MS = 12 * 60 * 60 * 1000;

export function leaseDir(dir) { return join(dir, 'leases'); }

export function touchLease(dir, sessionId) {
  mkdirSync(leaseDir(dir), { recursive: true });
  writeFileSync(join(leaseDir(dir), sessionKey(sessionId)), String(Date.now()));
}

// → true if this session HAD a lease (it used the shared browser).
export function dropLease(dir, sessionId) {
  const p = join(leaseDir(dir), sessionKey(sessionId));
  const had = existsSync(p);
  rmSync(p, { force: true });
  return had;
}

// Live leases (expired ones are deleted on the way). `now` is injectable for tests.
export function liveLeases(dir, now = Date.now()) {
  let names = [];
  try { names = readdirSync(leaseDir(dir)); } catch { return []; }
  return names.filter((n) => {
    const p = join(leaseDir(dir), n);
    let age;
    try { age = now - statSync(p).mtimeMs; } catch { return false; }
    if (age > LEASE_TTL_MS) { rmSync(p, { force: true }); return false; }
    return true;
  });
}

const isCli = isMain(import.meta.url);
if (isCli) {
  const mode = process.argv[2];
  let input = null;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/invalid stdin */ }
  const sid = extractSessionId(input);
  const dir = dataDir();
  try {
    if (mode === 'touch') {
      ensureDataDir(dir);
      touchLease(dir, sid);
    } else if (mode === 'compact') {
      cleanupSessionMarkers(sid, dir);
    } else if (mode === 'end') {
      const had = dropLease(dir, sid);
      cleanupSessionMarkers(sid, dir);
      // Only the LAST session that used the browser stops it: a session that never touched it (a
      // `claude -p`, a cron, an OpenCode user, a human who only ran /tandem:browser-start) must not.
      if (had && liveLeases(dir).length === 0) {
        const daemon = join(dirname(fileURLToPath(import.meta.url)), 'chrome-daemon.sh');
        execFileSync('bash', [daemon, 'stop'], { stdio: 'ignore', timeout: 14000 });   // bash: Windows can't exec a .sh
      }
    }
  } catch { /* a hook must never break the session */ }
  process.exit(0);
}
