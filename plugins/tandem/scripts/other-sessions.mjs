#!/usr/bin/env node
// other-sessions.mjs — prints how many OTHER Claude Code sessions are alive on this machine, or
// "?" if it can't tell. Used by the SessionEnd path of chrome-daemon.sh so the shared Chrome is
// only stopped by the last session.
//
// Source: `claude agents --json` (documented; lists every live session with its pid). This hook's
// own session is $CLAUDE_PID, which Claude Code exports to hook commands — also in a session
// launched from another one, where it carries its own pid, not the parent's. Without it, any
// ancestor process of this script counts as "self".
import { execFileSync } from 'node:child_process';

function ancestors() {
  const pids = new Set();
  let pid = process.pid;
  for (let i = 0; i < 32 && pid > 1; i++) {
    pids.add(pid);
    try {
      pid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)],
        { encoding: 'utf8', timeout: 500 }).trim());
    } catch { break; }
  }
  return pids;
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

try {
  const envPid = process.env.CLAUDE_PID || '';
  const self = /^\d+$/.test(envPid) ? new Set([Number(envPid)]) : ancestors();
  const out = execFileSync('claude', ['agents', '--json'],
    { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] });
  const sessions = JSON.parse(out);
  if (!Array.isArray(sessions)) throw new Error('not a list');
  const n = sessions.filter((s) => s && Number.isInteger(s.pid) && !self.has(s.pid) && alive(s.pid)).length;
  process.stdout.write(`${n}\n`);
} catch {
  process.stdout.write('?\n');
}
