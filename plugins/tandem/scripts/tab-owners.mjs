// tab-owners.mjs — who owns each tab, shared by every tandem session on this machine.
//
// Each session runs its own CDP relay (cdp-relay.mjs) with its own in-process owner map. Inside one relay,
// "not mine" is all it needs to hide a tab; but a tab another SESSION's agent opened and a tab the HUMAN
// opened look the same from there, and handing a tab over (adoption) must only ever offer the human's.
// So every relay also writes what its agents own here: one file per target, <dataDir>/owners/<targetId>,
// holding {pid, agent}. pid = the relay's process (the session's MCP launcher): a claim whose pid is gone
// is stale (crashed session) and reads as nobody's — the tab goes back to the human.
//
// Files, not a daemon: no process to keep alive, and a crash leaves at worst a stale file that the pid
// check ignores and sweep() removes. Target ids are Chrome's hex ids; anything else is refused (they become
// file names).

import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[A-Fa-f0-9]{8,64}$/;

export function ownersDir(dataDir) { return join(dataDir, 'owners'); }

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function tabOwners(dataDir, { pid = process.pid } = {}) {
  const dir = ownersDir(dataDir);
  const file = (id) => { if (!ID.test(id)) throw new Error(`tab-owners: bad target id ${JSON.stringify(id)}`); return join(dir, id); };
  const read = (id) => {
    try {
      const o = JSON.parse(readFileSync(file(id), 'utf8'));
      return Number.isInteger(o.pid) && alive(o.pid) ? o : null;
    } catch { return null; }
  };
  return {
    claim(targetId, agent) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writeFileSync(file(targetId), JSON.stringify({ pid, agent }), { mode: 0o600 });
    },
    // Only drops our own claim: another session may have adopted the tab since.
    release(targetId) {
      const o = read(targetId);
      if (o && o.pid === pid) rmSync(file(targetId), { force: true });
    },
    // → { pid, agent } of a LIVE owner, or null (nobody's = the human's).
    lookup: read,
    // 'mine' | 'session' (another live session's) | 'human'
    classify(targetId) {
      const o = read(targetId);
      return !o ? 'human' : o.pid === pid ? 'mine' : 'session';
    },
    // Remove claims of dead sessions and of targets that no longer exist (liveIds: current page ids).
    sweep(liveIds) {
      let names = [];
      try { names = readdirSync(dir); } catch { return 0; }
      const live = liveIds ? new Set(liveIds) : null;
      let n = 0;
      for (const id of names) {
        if (!ID.test(id)) continue;
        if (!read(id) || (live && !live.has(id))) { rmSync(join(dir, id), { force: true }); n++; }
      }
      return n;
    },
  };
}
