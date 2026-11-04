// agents-finished.mjs — "this subagent finished", from the SubagentStop hook to the launcher that runs its MCP.
//
// The hook is another process and doesn't know which launcher holds the agent, but agent ids don't repeat
// between sessions, so a marker per agent under the shared data dir is enough: the launcher looks for its own
// live agents' markers on its life-cycle tick (agent-router.mjs). The hook fires for every subagent, also for
// those that never touched the browser, so nobody ever consumes their markers: each write prunes old ones.

import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sessionKey } from './map-inject-core.mjs';

export const FINISHED_MAX_AGE_MS = 60 * 60 * 1000;

const dirOf = (dir) => join(dir, 'agents-finished');
const pathOf = (dir, agent) => join(dirOf(dir), sessionKey(agent));

export function markFinished(dir, agent, now = Date.now()) {
  mkdirSync(dirOf(dir), { recursive: true });
  for (const n of readdirSync(dirOf(dir))) {
    const p = join(dirOf(dir), n);
    try { if (now - statSync(p).mtimeMs > FINISHED_MAX_AGE_MS) rmSync(p, { force: true }); } catch { /* another hook got it */ }
  }
  writeFileSync(pathOf(dir, agent), '');
}

export const isFinished = (dir, agent) => existsSync(pathOf(dir, agent));
export const clearFinished = (dir, agent) => rmSync(pathOf(dir, agent), { force: true });
